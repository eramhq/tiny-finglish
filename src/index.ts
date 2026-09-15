/**
 * tiny-finglish — Finglish to Persian script, entirely in the browser.
 *
 * The pipeline, matching the plan:
 *
 *   [1] tokenize + protect   deterministic; URLs, emails, numbers, code, English
 *   [2] transduce            the learned core, or the rule baseline without weights
 *   [3] beam decode          top-k Persian candidates and confidence
 *   [4] lexicon snap         OPTIONAL, disabled by default (see M2)
 *   [5] sentence pass        lexicon tie-break, plus a Viterbi over word bigrams
 *
 * Works with no setup at all — the rule baseline needs no weights — and gets
 * better when a model, a lexicon, frequencies and bigrams are supplied.
 *
 * Steps [1] and [5] and the rule baseline live in `pipeline.ts`, which this
 * module extends. That split is what makes `tiny-finglish/rules` a real 5.2 KiB
 * entry point rather than a documented intention: the `Transducer` built below
 * is an unconditional import here, and no bundler can remove it for a consumer
 * who never passes `model`.
 */

import { beamDecode, scoreHypotheses, snapToLexicon, type Hypothesis } from "./decode.ts";
import { frequencyScore } from "./frequency.ts";
import { normalize } from "./normalize.ts";
import { Pipeline, round4, ZWNJ, type PipelineOptions } from "./pipeline.ts";
import { decodeArtifact, type WeightArtifact } from "./quant.ts";
import { Transducer } from "./runtime.ts";
import type { Candidate, TransliterateOptions, TransliterationResult } from "./types.ts";

export type {
  Candidate,
  CopyReason,
  Span,
  SpanAction,
  TransliterateOptions,
  TransliterationResult,
} from "./types.ts";
export { normalize, foldForMatch, isNormalized } from "./normalize.ts";
export { tokenize } from "./tokenize.ts";
export { decodeFrontCoded, encodeFrontCoded } from "./frontcode.ts";
export { decodeFrequencyTable, type FrequencyTable } from "./frequency.ts";
export { decodeBigramTable, type BigramTable } from "./bigram.ts";
export { RuleTransliterator } from "./rules-engine.ts";
export type { PipelineOptions } from "./pipeline.ts";
export type { WeightArtifact } from "./quant.ts";

export interface TransliteratorOptions extends PipelineOptions {
  /** Exported weights. Without them the rule baseline is used. */
  model?: WeightArtifact;
  /**
   * Run the rule baseline *and* the model on every word and arbitrate, instead
   * of letting the model decide alone. Requires `model`; ignored without it.
   *
   * Off by default. It does what it claims — the model's ZWNJ placement with
   * the rules' accuracy on real input — but the gold set it would be judged on
   * contains no ZWNJ at all, so the headline metric charges it three points for
   * placing one correctly. See `convertHybrid` and `src/metrics.ts`.
   */
  hybrid?: boolean;
  /**
   * Tier [4]. Off by default: the plan's position going into M2 is that the
   * model absorbs the vocabulary and the lexicon stays a training and
   * evaluation artifact. Turn it on only if the scaling curve says otherwise.
   */
  useLexiconSnap?: boolean;
}

/**
 * Weight on corpus frequency when reranking the model's candidates.
 *
 * A small noisy-channel correction: the transducer says which spellings are
 * *plausible* given the Finglish, and frequency says which are *likely* Persian.
 * Kept modest deliberately — the model is usually right, and a large weight
 * lets a common word override a confident, correct, rarer one.
 *
 * Tuned on the fixtures only. The gold set is never used for tuning.
 */
const FREQUENCY_RERANK = 2.0;

export class Transliterator extends Pipeline {
  private readonly transducer: Transducer | null;
  private readonly labels: readonly string[];
  private readonly inputIndex: ReadonlyMap<string, number>;
  private readonly unkId: number;
  private readonly hybrid: boolean;
  private readonly useLexiconSnap: boolean;

  constructor(options: TransliteratorOptions = {}) {
    super(options);
    this.hybrid = options.hybrid ?? false;
    this.useLexiconSnap = options.useLexiconSnap ?? false;

    if (options.model) {
      const weights = decodeArtifact(options.model);
      this.transducer = new Transducer(weights, options.model.config);
      this.labels = options.model.vocab.output;
      this.inputIndex = new Map(options.model.vocab.input.map((s, i) => [s, i]));
      this.unkId = this.inputIndex.get("<unk>") ?? 0;
    } else {
      this.transducer = null;
      this.labels = [];
      this.inputIndex = new Map();
      this.unkId = 0;
    }
  }

  override get hasModel(): boolean {
    return this.transducer !== null;
  }

  protected override convertWord(word: string, opts: TransliterateOptions): Candidate[] {
    if (!this.transducer) return this.convertWithRules(word, opts);
    return this.hybrid ? this.convertHybrid(word, opts) : this.convertWithModel(word, opts);
  }

  private convertWithModel(word: string, opts: TransliterateOptions): Candidate[] {
    const ids = new Int32Array(word.length);
    for (let i = 0; i < word.length; i++) {
      ids[i] = this.inputIndex.get(word[i]!) ?? this.unkId;
    }
    const logits = this.transducer!.forward(ids);
    let hypotheses = beamDecode(logits, word.length, this.labels.length, this.labels, {
      width: opts.beamWidth ?? 8,
      results: Math.max(opts.candidatesPerSpan ?? 3, 3),
    });
    if (this.useLexiconSnap && this.lexicon) {
      hypotheses = snapToLexicon(hypotheses, this.lexicon);
    }
    if (this.frequency) {
      hypotheses = [...hypotheses]
        .map((h) => ({
          ...h,
          logProb: h.logProb + FREQUENCY_RERANK * frequencyScore(this.frequency, normalize(h.output)),
        }))
        .sort((a, b) => b.logProb - a.logProb);
    }
    const { probabilities } = scoreHypotheses(hypotheses, word.length);
    return hypotheses.map((h: Hypothesis, i: number) => ({
      output: normalize(h.output),
      probability: round4(probabilities[i] ?? 0),
      reason: this.useLexiconSnap && this.lexicon?.has(h.output) ? "model + attested" : "model",
    }));
  }

  /**
   * Both engines, arbitrated — the hybrid path.
   *
   * The two are good at different things, measured per category on the
   * fixtures: the model wins ZWNJ (70.4% against 33.3%), adversarial input
   * (90.0% against 50.0%) and mixed English (90.6% against 78.1%), while
   * rules + frequency win ambiguity (70.6% against 64.7%), running sentences
   * (87.5% against 81.3%) and, on real human Finglish, the whole thing by 10.6
   * points. Running both costs nothing worth measuring — each is well under a
   * millisecond and both sit behind the same per-word memo.
   *
   * The one arbitration rule that is not a guess: **prefer the model when it
   * emits a ZWNJ and the rules do not.** That is not a close call between two
   * opinions, it is a capability gap — the rule tables in `src/rules.ts` can
   * only produce U+200C from a literal space or hyphen in the Latin, so on the
   * ~23% of Persian word types that contain one they are structurally unable to
   * be right. Everything else goes to the engine that wins on real input.
   *
   * Note that the headline word-accuracy metric folds ZWNJ to a space, so this
   * barely moves it by construction. It is measured on ZWNJ placement, which
   * `scripts/_report.ts` reports separately and which exists for this.
   */
  private convertHybrid(word: string, opts: TransliterateOptions): Candidate[] {
    const rules = this.convertWithRules(word, opts);
    const model = this.convertWithModel(word, opts);
    const modelFirst =
      (model[0]?.output.includes(ZWNJ) ?? false) && !(rules[0]?.output.includes(ZWNJ) ?? false);
    const [winner, loser] = modelFirst ? [model, rules] : [rules, model];

    // The loser's candidates are kept behind the winner's rather than dropped:
    // the two generators disagree about what is even *possible*, and that
    // disagreement is most of the value of running both.
    const seen = new Set(winner.map((c) => c.output));
    const extra = loser.filter((c) => !seen.has(c.output));
    return [...winner, ...extra].map((c) => ({
      ...c,
      reason: modelFirst && winner === model ? `${c.reason} (zwnj)` : c.reason,
    }));
  }
}

let defaultInstance: Transliterator | null = null;

/**
 * Convert Finglish to Persian using the process-wide default engine.
 *
 * With no setup this is the rule baseline, which needs no weights and no
 * network. Call `configure()` once with a model to upgrade every later call.
 */
export function transliterate(
  input: string,
  options: TransliterateOptions = {},
): TransliterationResult {
  defaultInstance ??= new Transliterator();
  return defaultInstance.transliterate(input, options);
}

/** Install the engine used by the module-level `transliterate()`. */
export function configure(options: TransliteratorOptions): Transliterator {
  defaultInstance = new Transliterator(options);
  return defaultInstance;
}

void ZWNJ;
void round4;

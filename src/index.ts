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
export { decodeVowelTable, type VowelTable } from "./vowels.ts";
export { RuleTransliterator } from "./rules-engine.ts";
export type { PipelineOptions } from "./pipeline.ts";
export type { WeightArtifact } from "./quant.ts";

export interface TransliteratorOptions extends PipelineOptions {
  /** Exported weights. Without them the rule baseline is used. */
  model?: WeightArtifact;
  /**
   * Rank the rule baseline's candidates and the model's in one score, instead
   * of letting the model decide alone. Requires `model`; ignored without it.
   *
   * On by default whenever a model is given: it is the most accurate setup on
   * the orthographic headline, gold scored once (rules 81.0, model alone 81.5,
   * hybrid 82.4), and it writes the half-space. `false` lets the model decide
   * alone. The strict tier ranks it below the rules only because no evaluation
   * reference writes ZWNJ. See `convertJoint` and `src/metrics.ts`.
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

/**
 * Joint hybrid constants. Tuned on dev and the fixtures, never on gold; the
 * sweep is in `convertJoint`'s docstring. `floor` is the model probability
 * charged to a candidate outside its beam.
 */
const JOINT = {
  model: 0.25,
  floor: 1e-3,
  beam: 8,
  results: 8,
  zwnj: true,
};

export class Transliterator extends Pipeline {
  private readonly transducer: Transducer | null;
  private readonly labels: readonly string[];
  private readonly inputIndex: ReadonlyMap<string, number>;
  private readonly unkId: number;
  /** The `<eos>` input id, when the weights were trained with the clause marker. */
  private readonly eosId: number | null;
  private readonly hybrid: boolean;
  private readonly useLexiconSnap: boolean;

  constructor(options: TransliteratorOptions = {}) {
    super(options);
    this.hybrid = options.hybrid ?? true;
    this.useLexiconSnap = options.useLexiconSnap ?? false;

    if (options.model) {
      const weights = decodeArtifact(options.model);
      this.transducer = new Transducer(weights, options.model.config);
      this.labels = options.model.vocab.output;
      this.inputIndex = new Map(options.model.vocab.input.map((s, i) => [s, i]));
      this.unkId = this.inputIndex.get("<unk>") ?? 0;
      this.eosId = options.model.clauseMarker ? this.inputIndex.get("<eos>") ?? null : null;
    } else {
      this.transducer = null;
      this.labels = [];
      this.inputIndex = new Map();
      this.unkId = 0;
      this.eosId = null;
    }
  }

  override get hasModel(): boolean {
    return this.transducer !== null;
  }

  protected override get usesClauseMarker(): boolean {
    return this.eosId !== null;
  }

  protected override convertWord(word: string, opts: TransliterateOptions, clauseFinal = false): Candidate[] {
    if (!this.transducer) return this.convertWithRules(word, opts);
    return this.hybrid ? this.convertJoint(word, opts, clauseFinal) : this.convertWithModel(word, opts, clauseFinal);
  }

  /**
   * Input ids for `word`, with `<eos>` appended when it ends a clause and the
   * weights were trained with the marker. Decoding reads only the word's own
   * positions (`beamDecode(logits, word.length, …)`), so the marker changes
   * what the last letters see and emits nothing itself.
   */
  private encode(word: string, clauseFinal: boolean): Int32Array {
    const marked = clauseFinal && this.eosId !== null;
    const ids = new Int32Array(word.length + (marked ? 1 : 0));
    for (let i = 0; i < word.length; i++) ids[i] = this.inputIndex.get(word[i]!) ?? this.unkId;
    if (marked) ids[word.length] = this.eosId!;
    return ids;
  }

  /**
   * Both engines in one ranking — the hybrid path.
   *
   * The rules generate candidates (beam and dictionary), and the model's own
   * beam is added to the same pool. Every candidate is then scored as the rule
   * engine's channel + frequency score plus `JOINT.model` x log P_model, with a
   * floor for candidates the model's beam did not reach. Candidates are compared
   * with ZWNJ removed, since the rules never emit one. When the model has a ZWNJ
   * form of the winner, that form is emitted: ZWNJ is the model's strength and a
   * capability the rule tables do not have.
   *
   * This replaces an arbitration that let the model win only when it emitted a
   * ZWNJ and the rules did not. That rule could not use the model's evidence on
   * any other word, which was the right call while the model was 11 points
   * behind on real input. It is not the right call once the model is trained on
   * LLM-typed Finglish (`build_distill.py`), because the model's vocabulary
   * knowledge then adds to the rules' instead of losing to it. Measured on dev
   * with those weights (strict / faithful / orthographic-faithful, fixtures):
   *
   *     rules alone                   58.2 / 69.3 / 72.8   83.3
   *     joint, model 0.25, no ZWNJ    58.9 / 70.1 / 73.7   84.0
   *     joint, model 0.25, ZWNJ       57.0 / 67.8 / 73.3   86.9   <- shipped
   *     joint, model 1.0,  ZWNJ       56.4 / 67.2 / 73.0   85.9
   *
   * With ZWNJ the strict figure drops, because neither real evaluation set
   * writes one and the metric splits a correct می‌کنم into two words. That is
   * the documented handicap in `src/metrics.ts`, not an accuracy loss.
   */
  private convertJoint(word: string, opts: TransliterateOptions, clauseFinal: boolean): Candidate[] {
    const hypotheses = this.modelHypotheses(word, JOINT.beam, clauseFinal);
    const model = new Map<string, { logProb: number; form: string }>();
    for (const h of hypotheses) {
      const key = h.output.replaceAll(ZWNJ, "");
      if (!model.has(key)) model.set(key, h);
    }
    const pool = this.baseline.transliterate(word, { results: JOINT.results, extra: [...model.keys()] });
    if (pool.length === 0) return this.convertWithModel(word, opts, clauseFinal);

    const floor = Math.log(JOINT.floor);
    const scored = pool.map((c) => {
      const m = model.get(c.output);
      return {
        output: m && JOINT.zwnj ? m.form : c.output,
        score: c.score + JOINT.model * (m ? m.logProb : floor),
        reason: m ? `${c.reason} + model ${m.logProb.toFixed(2)}` : c.reason,
      };
    }).sort((a, b) => b.score - a.score);
    const max = scored[0]!.score;
    const weights = scored.map((c) => Math.exp(c.score - max));
    const total = weights.reduce((a, b) => a + b, 0);
    return scored.slice(0, Math.max(opts.candidatesPerSpan ?? 3, 3)).map((c, i) => ({
      output: normalize(c.output),
      probability: round4(weights[i]! / total),
      reason: c.reason,
    }));
  }

  /** The model's beam, log-softmax over the returned set, no frequency rerank. */
  private modelHypotheses(
    word: string, width: number, clauseFinal: boolean,
  ): Array<{ output: string; logProb: number; form: string }> {
    const logits = this.transducer!.forward(this.encode(word, clauseFinal));
    const hypotheses = beamDecode(logits, word.length, this.labels.length, this.labels, { width, results: width });
    const { probabilities } = scoreHypotheses(hypotheses, word.length);
    return hypotheses.map((h, i) => {
      const form = normalize(h.output);
      return { output: form, form, logProb: Math.log(Math.max(probabilities[i] ?? 0, 1e-9)) };
    });
  }

  private convertWithModel(word: string, opts: TransliterateOptions, clauseFinal: boolean): Candidate[] {
    const logits = this.transducer!.forward(this.encode(word, clauseFinal));
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

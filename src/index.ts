/**
 * tiny-finglish — Finglish to Persian script, entirely in the browser.
 *
 * The pipeline, matching the plan:
 *
 *   [1] tokenize + protect   deterministic; URLs, emails, numbers, code, English
 *   [2] transduce            the learned core, or the rule baseline without weights
 *   [3] beam decode          top-k Persian candidates and confidence
 *   [4] lexicon snap         OPTIONAL, disabled by default (see M2)
 *   [5] sentence pass        resolve remaining ambiguity across spans
 *
 * Works with no setup at all — the rule baseline needs no weights — and gets
 * better when a model and a lexicon are supplied.
 */

import { RuleBaseline } from "./baseline.ts";
import { beamDecode, scoreHypotheses, snapToLexicon, type Hypothesis } from "./decode.ts";
import { normalize } from "./normalize.ts";
import { decodeArtifact, type WeightArtifact } from "./quant.ts";
import { Transducer } from "./runtime.ts";
import { tokenize, type Token } from "./tokenize.ts";
import type {
  Candidate,
  Span,
  TransliterateOptions,
  TransliterationResult,
} from "./types.ts";

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
export type { WeightArtifact } from "./quant.ts";

export interface TransliteratorOptions {
  /** Exported weights. Without them the rule baseline is used. */
  model?: WeightArtifact;
  /**
   * Attested Persian words. Used to rank rule-baseline candidates, and — only
   * when `useLexiconSnap` is on — to rerank model output.
   */
  lexicon?: ReadonlySet<string>;
  /**
   * Tier [4]. Off by default: the plan's position going into M2 is that the
   * model absorbs the vocabulary and the lexicon stays a training and
   * evaluation artifact. Turn it on only if the scaling curve says otherwise.
   */
  useLexiconSnap?: boolean;
  /** Words cached on the incremental typing path. */
  cacheSize?: number;
}

const DEFAULT_OPTIONS: Required<Pick<TransliterateOptions,
  "alternatives" | "beamWidth" | "candidatesPerSpan" | "persianPunctuation" | "backend">> = {
  alternatives: 3,
  beamWidth: 8,
  candidatesPerSpan: 3,
  persianPunctuation: true,
  backend: "auto",
};

export class Transliterator {
  private readonly baseline: RuleBaseline;
  private readonly transducer: Transducer | null;
  private readonly labels: readonly string[];
  private readonly inputIndex: ReadonlyMap<string, number>;
  private readonly unkId: number;
  private readonly lexicon: ReadonlySet<string> | undefined;
  private readonly useLexiconSnap: boolean;
  /**
   * Word-level memo. This is what keeps the typing path inside a 16 ms frame:
   * a keystroke re-converts only the word being edited, never the sentence.
   */
  private readonly cache = new Map<string, Candidate[]>();
  private readonly cacheSize: number;

  constructor(options: TransliteratorOptions = {}) {
    this.lexicon = options.lexicon;
    this.useLexiconSnap = options.useLexiconSnap ?? false;
    this.cacheSize = options.cacheSize ?? 2048;
    this.baseline = new RuleBaseline({ ...(options.lexicon ? { lexicon: options.lexicon } : {}) });

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

  /** True when a learned model is driving conversion rather than the rules. */
  get hasModel(): boolean {
    return this.transducer !== null;
  }

  transliterate(input: string, options: TransliterateOptions = {}): TransliterationResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const tokens = tokenize(input, {
      protect: options.protect ?? [],
      forceConvert: options.forceConvert ?? [],
    });

    const spans: Span[] = [];
    for (const token of tokens) {
      spans.push(this.spanFor(token, opts));
    }

    this.sentencePass(spans);

    const text = spans.map((s) => s.output).join("");
    const converted = spans.filter((s) => s.action === "convert");
    const confidence = converted.length
      ? Math.exp(converted.reduce((sum, s) => sum + Math.log(Math.max(s.confidence, 1e-9)), 0) / converted.length)
      : 1;

    return {
      text,
      alternatives: this.alternatives(spans, opts.alternatives),
      confidence: round4(confidence),
      spans,
    };
  }

  // -- per-token ----------------------------------------------------------

  private spanFor(token: Token, opts: typeof DEFAULT_OPTIONS & TransliterateOptions): Span {
    const base = { input: token.text, start: token.start, end: token.end };

    if (token.kind === "protected") {
      return { ...base, output: token.text, action: "copy", confidence: 1, copyReason: token.reason! };
    }
    if (token.kind === "space") {
      return { ...base, output: token.text, action: "space", confidence: 1 };
    }
    if (token.kind === "punct") {
      const output = opts.persianPunctuation
        ? normalize(token.text, { punctuation: true, digits: "preserve" })
        : token.text;
      return { ...base, output, action: "punct", confidence: 1 };
    }

    const candidates = this.convert(token.text, opts);
    const best = candidates[0];
    return {
      ...base,
      output: best?.output ?? token.text,
      action: "convert",
      confidence: round4(best?.probability ?? 0),
      candidates: candidates.slice(0, opts.candidatesPerSpan ?? 3),
    };
  }

  private convert(word: string, opts: TransliterateOptions): Candidate[] {
    const key = word.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const candidates = this.transducer ? this.convertWithModel(key, opts) : this.convertWithRules(key, opts);

    if (this.cache.size >= this.cacheSize) {
      // Cheap FIFO eviction. A true LRU costs more bookkeeping than it saves at
      // this hit rate, since the working set while typing is a few dozen words.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, candidates);
    return candidates;
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
    const { probabilities } = scoreHypotheses(hypotheses, word.length);
    return hypotheses.map((h: Hypothesis, i: number) => ({
      output: normalize(h.output),
      probability: round4(probabilities[i] ?? 0),
      reason: this.useLexiconSnap && this.lexicon?.has(h.output) ? "model + attested" : "model",
    }));
  }

  private convertWithRules(word: string, opts: TransliterateOptions): Candidate[] {
    const results = this.baseline.transliterate(word, {
      results: Math.max(opts.candidatesPerSpan ?? 3, 3),
    });
    if (results.length === 0) {
      return [{ output: word, probability: 0, reason: "no rule matched; copied" }];
    }
    const max = Math.max(...results.map((r) => r.score));
    const weights = results.map((r) => Math.exp(r.score - max));
    const total = weights.reduce((a, b) => a + b, 0);
    return results.map((r, i) => ({
      output: normalize(r.output),
      probability: round4(weights[i]! / total),
      reason: r.reason,
    }));
  }

  /**
   * Step [5] — the sentence-level pass.
   *
   * Currently promotes an attested alternative over an unattested best guess
   * when the two are close, which is the part of sentence context that works
   * without a language model. The measured literature is unambiguous that this
   * is where the remaining accuracy lives: on the closest comparable task,
   * adding context moved word error from 33.8% to 12.2%, while swapping the
   * model architecture moved it by under one point. A real n-gram or
   * class-based LM belongs here, and this is the seam it plugs into.
   */
  private sentencePass(spans: Span[]): void {
    if (!this.lexicon) return;
    for (const span of spans) {
      if (span.action !== "convert" || !span.candidates || span.candidates.length < 2) continue;
      const best = span.candidates[0]!;
      if (this.lexicon.has(best.output)) continue;
      const attested = span.candidates.find((c) => this.lexicon!.has(c.output));
      // Only override a genuinely uncertain call. A confident model answer that
      // is simply not in a 100k-stem lexicon is usually an inflected form, not
      // a mistake, and overriding it would be worse than leaving it.
      if (attested && best.probability - attested.probability < 0.25) {
        span.output = attested.output;
        span.confidence = round4(attested.probability);
        span.candidates = [attested, ...span.candidates.filter((c) => c !== attested)];
      }
    }
  }

  /**
   * Whole-text alternatives, produced by varying the least-confident spans one
   * at a time rather than enumerating a cross product — the same reason the
   * baseline uses a beam.
   */
  private alternatives(spans: readonly Span[], limit: number): string[] {
    if (limit <= 0) return [];
    const varied = spans
      .map((span, index) => ({ span, index }))
      .filter(({ span }) => span.action === "convert" && (span.candidates?.length ?? 0) > 1)
      .sort((a, b) => a.span.confidence - b.span.confidence)
      .slice(0, limit);

    const base = spans.map((s) => s.output);
    const out: string[] = [];
    const seen = new Set([base.join("")]);
    for (const { span, index } of varied) {
      for (const candidate of span.candidates!.slice(1)) {
        const copy = [...base];
        copy[index] = candidate.output;
        const text = copy.join("");
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
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

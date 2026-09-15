/**
 * The model-independent half of the pipeline.
 *
 * Everything here — tokenizing, span assembly, the per-word memo, the rule
 * baseline, the sentence pass and its Viterbi — runs without a byte of neural
 * runtime. It lives in its own module so that it can be *bundled* without one.
 * `Transliterator` builds a `Transducer` in its constructor, which makes
 * `quant.ts` and `runtime.ts` unconditional imports of `index.ts`; no bundler
 * can tree-shake them away for a consumer who never passes `model`. Measured
 * with `node scripts/size.ts --tiers`, that is the difference between 9.1 KiB
 * and 5.2 KiB Brotli.
 *
 * `Transliterator` extends this and overrides one method. `RuleTransliterator`
 * in `rules-engine.ts` extends it and overrides nothing, which is the point:
 * the rules-only tier is the same pipeline, not a reduced copy of it that could
 * drift.
 */

import { RuleBaseline } from "./baseline.ts";
import { bigramScore, type BigramTable } from "./bigram.ts";
import { type FrequencyTable } from "./frequency.ts";
import { normalize } from "./normalize.ts";
import { tokenize, type Token } from "./tokenize.ts";
import type {
  Candidate,
  Span,
  TransliterateOptions,
  TransliterationResult,
} from "./types.ts";

export interface PipelineOptions {
  /**
   * Attested Persian words. Used to rank rule-baseline candidates, and — only
   * when `useLexiconSnap` is on — to rerank model output.
   */
  lexicon?: ReadonlySet<string>;
  /**
   * Word frequencies, from `decodeFrequencyTable`. Used to rerank candidates:
   * the model says which spellings are plausible, this says which are likely.
   */
  frequency?: FrequencyTable;
  /**
   * Word bigrams, from `decodeBigramTable`. Turns step [5] from a lexicon
   * tie-break into a Viterbi pass over the whole sentence. Optional and a
   * separate fetch, like the frequency table.
   */
  bigram?: BigramTable;
  /** Words cached on the incremental typing path. */
  cacheSize?: number;
}

/** U+200C. Meaningful inside a Persian word; inert anywhere else. */
export const ZWNJ = "\u200C";

/**
 * Weight on bigram association in the sentence pass.
 *
 * The per-candidate generation score is a log probability over the candidates
 * for one span; the bigram term is a normalized PMI in [0,1]. This constant is
 * what puts them on one scale, so it is not a free knob so much as a unit
 * conversion with a confidence attached. Tuned on `data/fixtures/` only.
 */
const BIGRAM_WEIGHT = 6.0;

/**
 * Candidates per span the sentence pass gets to choose between.
 *
 * Independent of `candidatesPerSpan`, which is how many are *reported*. A
 * reranker with three options cannot reach the ceiling `scripts/oracle.ts`
 * measures at eight, and widening the reported list instead would change the
 * shape of every `Span` for callers who never asked for a language model.
 */
const CONTEXT_CANDIDATES = 8;

const DEFAULT_OPTIONS: Required<Pick<TransliterateOptions,
  "alternatives" | "beamWidth" | "candidatesPerSpan" | "persianPunctuation" | "backend">> = {
  alternatives: 3,
  beamWidth: 8,
  candidatesPerSpan: 3,
  persianPunctuation: true,
  backend: "auto",
};

export abstract class Pipeline {
  protected readonly baseline: RuleBaseline;
  protected readonly lexicon: ReadonlySet<string> | undefined;
  protected readonly frequency: FrequencyTable | undefined;
  protected readonly bigram: BigramTable | undefined;
  /**
   * Word-level memo. This is what keeps the typing path inside a 16 ms frame:
   * a keystroke re-converts only the word being edited, never the sentence.
   */
  private readonly cache = new Map<string, Candidate[]>();
  private readonly cacheSize: number;

  constructor(options: PipelineOptions = {}) {
    this.lexicon = options.lexicon;
    this.frequency = options.frequency;
    this.bigram = options.bigram;
    this.cacheSize = options.cacheSize ?? 2048;
    this.baseline = new RuleBaseline({
      ...(options.lexicon ? { lexicon: options.lexicon } : {}),
      ...(options.frequency ? { frequency: options.frequency } : {}),
    });
  }

  /** True when a learned model is driving conversion rather than the rules. */
  get hasModel(): boolean {
    return false;
  }

  /** True when step [5] has sentence context to work with. */
  get hasContext(): boolean {
    return this.bigram !== undefined;
  }

  /**
   * Candidates for one word — the single seam a model plugs into.
   *
   * The base implementation is the rule baseline, which is also what
   * `Transliterator` falls back to when no weights are supplied.
   */
  protected convertWord(word: string, opts: TransliterateOptions): Candidate[] {
    return this.convertWithRules(word, opts);
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
    // Trim to the reported width only after the sentence pass, which needs a
    // wider list than a caller asked to see.
    for (const span of spans) {
      if (span.candidates) span.candidates = span.candidates.slice(0, opts.candidatesPerSpan);
    }

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
      // Sliced after `sentencePass`, not here.
      candidates: [...candidates],
    };
  }

  protected convert(word: string, opts: TransliterateOptions): Candidate[] {
    const key = word.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;

    const wide = this.bigram
      ? { ...opts, candidatesPerSpan: Math.max(opts.candidatesPerSpan ?? 3, CONTEXT_CANDIDATES) }
      : opts;
    const candidates = this.convertWord(key, wide);

    if (this.cache.size >= this.cacheSize) {
      // Cheap FIFO eviction. A true LRU costs more bookkeeping than it saves at
      // this hit rate, since the working set while typing is a few dozen words.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, candidates);
    return candidates;
  }

  protected convertWithRules(word: string, opts: TransliterateOptions): Candidate[] {
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
   * With a bigram table, a Viterbi decode over the per-span candidate lists.
   * Without one, the lexicon tie-break that was here before it: promote an
   * attested alternative over an unattested best guess when the two are close.
   *
   * **The word memo does not need invalidating, and that is the whole design.**
   * `convert()` caches *candidate generation*, which is context-free and stays
   * context-free; the sentence pass only reorders a cached list. Keeping a
   * lattice cache instead would mean invalidating on every keystroke, and the
   * lattice is far cheaper to recompute than to invalidate correctly — a warm
   * 15-word sentence including this pass measures 0.02 ms against a 16 ms
   * frame, so there is nothing to save.
   *
   * What this can buy is bounded and was measured before it was built:
   * `scripts/oracle.ts` puts a *perfect* reranker at +9.6 points on the gold
   * set, because 20.3% of reference words are never in the candidate list at
   * all. The roadmap previously assumed a much larger number, from prior art
   * whose candidate generator was a pair 6-gram FST rather than this beam.
   */
  protected sentencePass(spans: Span[]): void {
    if (this.bigram) this.contextPass(spans);
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
   * Viterbi over one run of adjacent convertible spans.
   *
   * Spans are conditionally independent given their candidate lists, so this is
   * a small dynamic program rather than a search: `slots x k x k` additions,
   * about 960 for a fifteen-word sentence at k=8.
   *
   * The chain breaks at punctuation and at copy spans. A URL or an English word
   * is not a Persian word, and letting one become a bigram context would leak
   * the tokenizer's protected spans into the language model; a full stop ends a
   * sentence, which is the unit the model was counted over. Runs of whitespace
   * do not break it — a space is what separates two words in the first place.
   */
  private contextPass(spans: Span[]): void {
    let run: Span[] = [];
    const flush = () => {
      if (run.length > 1) this.viterbi(run);
      run = [];
    };
    for (const span of spans) {
      if (span.action === "convert" && span.candidates && span.candidates.length) run.push(span);
      else if (span.action !== "space") flush();
    }
    flush();
  }

  private viterbi(run: readonly Span[]): void {
    const lists = run.map((span) => span.candidates!);
    // Generation evidence, as a log probability. Floored rather than allowed to
    // reach -Infinity: a candidate rounded to probability 0 is still a
    // candidate, and the bigram term is exactly the evidence that might rescue
    // it.
    const emit = lists.map((list) => list.map((c) => Math.log(Math.max(c.probability, 1e-6))));

    let previous = emit[0]!.slice();
    const back: number[][] = [];

    for (let i = 1; i < lists.length; i++) {
      const row = lists[i]!;
      const scores = new Array<number>(row.length);
      const pointers = new Array<number>(row.length);
      for (let c = 0; c < row.length; c++) {
        let bestScore = -Infinity;
        let bestFrom = 0;
        for (let p = 0; p < previous.length; p++) {
          const score =
            previous[p]! +
            BIGRAM_WEIGHT * bigramScore(this.bigram, lists[i - 1]![p]!.output, row[c]!.output);
          if (score > bestScore) {
            bestScore = score;
            bestFrom = p;
          }
        }
        scores[c] = bestScore + emit[i]![c]!;
        pointers[c] = bestFrom;
      }
      back.push(pointers);
      previous = scores;
    }

    const path = new Array<number>(lists.length);
    let at = 0;
    for (let c = 1; c < previous.length; c++) if (previous[c]! > previous[at]!) at = c;
    path[lists.length - 1] = at;
    for (let i = lists.length - 1; i > 0; i--) {
      at = back[i - 1]![at]!;
      path[i - 1] = at;
    }

    run.forEach((span, i) => {
      const chosen = span.candidates![path[i]!]!;
      if (chosen === span.candidates![0]) return;
      span.output = chosen.output;
      span.confidence = round4(chosen.probability);
      span.candidates = [chosen, ...span.candidates!.filter((c) => c !== chosen)];
    });
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

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

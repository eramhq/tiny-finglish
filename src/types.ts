/**
 * The public contract. Shaped to match `PLAN.md`'s worked example and
 * `elektito/finglish`'s API (a list of possibilities, each with a confidence
 * in [0,1]) so that the two are mutually intelligible.
 *
 * Design rule: never pretend an answer is certain. Every level of the result —
 * whole text, span, and word candidate — carries its own confidence, and
 * alternatives are always available rather than silently discarded.
 */

/** What the pipeline decided to do with a source span. */
export type SpanAction =
  /** Finglish that was transliterated into Persian script. */
  | "convert"
  /** Passed through byte-identical: URL, email, @mention, number, code, English. */
  | "copy"
  /** Punctuation, possibly localized (`?` → `؟`). */
  | "punct"
  /** Whitespace. */
  | "space";

/** Why a span was protected from conversion. Surfaced in the playground. */
export type CopyReason =
  | "url"
  | "email"
  | "mention"
  | "hashtag"
  | "number"
  | "code"
  | "emoji"
  | "english"
  | "non-latin"
  | "unknown-script";

/** One alternative Persian rendering of a single source span. */
export interface Candidate {
  output: string;
  /** Normalized probability in [0,1] across the returned candidate list. */
  probability: number;
  /**
   * Human-readable account of where this came from — the rule that fired, or
   * the decode path. `PLAN.md`'s M1 exit condition requires this be inspectable.
   */
  reason: string;
}

/** A contiguous piece of the input and what became of it. */
export interface Span {
  /** Source text, exactly as it appeared. */
  input: string;
  /** Result text for this span. */
  output: string;
  action: SpanAction;
  /** Code-unit offsets into the original input. `input === source.slice(start, end)`. */
  start: number;
  end: number;
  /** Present when `action === "copy"`. */
  copyReason?: CopyReason;
  /** Present when `action === "convert"`. Best-first, includes `output` at [0]. */
  candidates?: Candidate[];
  /** Confidence for this span alone, in [0,1]. */
  confidence: number;
}

/** The result of `transliterate()`. */
export interface TransliterationResult {
  /** Best rendering. */
  text: string;
  /** Whole-text alternatives, best-first, excluding `text`. May be empty. */
  alternatives: string[];
  /** Confidence for `text`, in [0,1]. Geometric mean over converted spans. */
  confidence: number;
  /** Every span of the input in order; concatenating `output` reproduces `text`. */
  spans: Span[];
}

export interface TransliterateOptions {
  /**
   * How many whole-text alternatives to return. Alternatives are produced by
   * varying the least-confident spans first, not by enumerating a cross product.
   * @default 3
   */
  alternatives?: number;
  /**
   * Beam width for the per-word decode. Larger is slower and more thorough;
   * the latency budget in `docs/benchmarks.md` is measured at the default.
   * @default 8
   */
  beamWidth?: number;
  /**
   * Candidates kept per span in `Span.candidates`.
   * @default 3
   */
  candidatesPerSpan?: number;
  /**
   * Localize `? ; ,` to `؟ ؛ ،` in Persian runs. Never applied inside a
   * protected span.
   * @default true
   */
  persianPunctuation?: boolean;
  /**
   * Additional tokens to pass through untouched, matched case-insensitively
   * against the whole token. Use for product names the English list misses.
   * @default []
   */
  protect?: readonly string[];
  /**
   * Tokens to always convert even if the English detector would protect them.
   * Takes precedence over `protect`.
   * @default []
   */
  forceConvert?: readonly string[];
  /**
   * Inference backend. `"auto"` is CPU today; it exists so that a future
   * WebGPU escalation (see `gpu-time`'s batch threshold) is not a breaking
   * change. `"cpu"` pins the scalar JS path.
   * @default "auto"
   */
  backend?: "auto" | "cpu";
}

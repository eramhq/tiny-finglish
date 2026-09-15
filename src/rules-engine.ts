/**
 * `tiny-finglish/rules` — the whole pipeline, none of the neural runtime.
 *
 * Identical behaviour to `Transliterator` constructed without `model`, at 5.2
 * KiB Brotli instead of 9.1: `index.ts` builds a `Transducer` in its
 * constructor, so `quant.ts` and `runtime.ts` are unconditional imports there
 * and `"sideEffects": false` cannot help a bundler remove them.
 *
 * It is not a reduced reimplementation. It extends the same `Pipeline` and
 * overrides nothing, so tokenizing, span assembly, the memo, the frequency
 * rerank and the sentence pass are the same code the full entry runs — which is
 * the only way the two tiers stay honest about scoring the same.
 *
 * The data artifacts are still separate fetches and still optional:
 *
 * ```ts
 * import { RuleTransliterator, decodeFrequencyTable } from "tiny-finglish/rules";
 *
 * const frequency = decodeFrequencyTable(await fetchBytes("/fa-frequency.bin"));
 * const engine = new RuleTransliterator({ frequency });
 * engine.transliterate("man emrooz miram daneshgah");
 * ```
 *
 * Measured on the 1,835-pair gold set: 56.2% with no data at all, 62.3% with
 * the frequency table, 63.2% with frequencies and bigrams — which is the best
 * figure this project produces on real human Finglish, learned model included.
 */

import { Pipeline, type PipelineOptions } from "./pipeline.ts";

export type { PipelineOptions } from "./pipeline.ts";
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
export { RuleBaseline, matchKeySet } from "./baseline.ts";

/** The rule baseline behind the full span pipeline. No weights, no runtime. */
export class RuleTransliterator extends Pipeline {
  constructor(options: PipelineOptions = {}) {
    super(options);
  }
}

/**
 * Word-frequency table.
 *
 * Lexicon membership says a word exists; it cannot say which of two real words
 * a user meant. Both سلام and سلم are Persian, and without frequency the rule
 * baseline ranked سلم first — a visible, reproducible error that membership
 * alone could never fix.
 *
 * Built by `training/tiny_finglish_training/build_frequency.py` from the
 * Persian side of HomoRich (CC0-1.0). 25,000 words covering 97.4% of token
 * mass, 55 KiB Brotli.
 *
 * Format (after Brotli): the front-coded word list from `frontcode.ts`,
 * followed by one byte per word — its frequency log-quantized to 0-255, in the
 * same (sorted) order. Frequency spans about six orders of magnitude and only
 * its logarithm is ever used as a ranking score, so a byte is ample.
 */

import { decodeFrontCodedAt } from "./frontcode.ts";

export type FrequencyTable = ReadonlyMap<string, number>;

/** Decode the artifact into word -> log-quantized frequency in [0,1]. */
export function decodeFrequencyTable(bytes: Uint8Array): FrequencyTable {
  const { words, offset } = decodeFrontCodedAt(bytes, 0);
  if (bytes.length - offset < words.length) {
    throw new Error(
      `frequency artifact is truncated: ${words.length} words but ${bytes.length - offset} rank bytes`,
    );
  }
  const table = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    table.set(words[i]!, bytes[offset + i]! / 255);
  }
  return table;
}

/**
 * Score contribution of a candidate's frequency.
 *
 * Returns 0 for an unknown word rather than a penalty. The table covers 25,000
 * types; Persian morphology generates far more, so absence usually means
 * "inflected form we did not count", not "not a word". Penalizing absence
 * would systematically punish correct inflections.
 *
 * **Backing off to the stem's frequency was tried here and is not kept.** The
 * arithmetic looks convincing — 93.6% of gold reference words are in the table
 * and a further 2.2% strip to a stem that is — but scoring `کتابش` at a
 * discounted `کتاب` loses accuracy monotonically in the discount, on fixtures
 * (71.5% -> 70.2% at every value from 0.2 to 1.0) and on gold (62.3% ->
 * 62.1%). The reason is that a Persian suffix list matches far more than
 * suffixes: `م`, `ت`, `ش` and `ی` end ordinary words too, so the back-off
 * hands a real score to whichever wrong candidate happens to end in a common
 * letter. Making it safe needs the stem's *flags*, which the shipped artifact
 * does not carry. Expanding the lexicon instead fails worse — see
 * `scripts/build-lexicon.ts`.
 */
export function frequencyScore(table: FrequencyTable | undefined, word: string): number {
  if (!table) return 0;
  return table.get(word) ?? 0;
}

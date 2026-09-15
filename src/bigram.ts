/**
 * Word-bigram table — sentence context.
 *
 * Frequency says which Persian word is likely; this says which is likely
 * *here*. `ghaleb` reaches قالب, قلب and غالب, all real, all attested, all
 * plausible in isolation, and only the neighbours decide. That is the whole
 * job of `sentencePass()` in `index.ts`, and this is the evidence it runs on.
 *
 * **Not shipped by default.** 73.6 KiB for +0.9 points of gold word accuracy on
 * the rule baseline is 82 KiB per point, against 8.9 for the frequency table —
 * the worst accuracy-per-byte artifact in the repository, so the default
 * download does not pay for it and the headline does not claim it. Pass
 * `bigram` to `Transliterator` to opt in; `scripts/run-fixtures.ts --bigram`
 * scores it, and `bigramGain` in `data/results/comparison.json` publishes what
 * it buys for each configuration.
 *
 * Built by `training/tiny_finglish_training/build_bigram.py` from the Persian
 * side of HomoRich (CC0-1.0), through the same gold-sentence exclusion the
 * frequency table uses — literally the same function, because a bigram model
 * memorizes sentence-local structure far more readily than a unigram count
 * does and a divergence there would leak.
 *
 * **Scores are pointwise mutual information, not conditional probability**, so
 * that a missing pair means zero rather than a large negative number. With
 * log P(w2|w1) every stored pair would score worse than every pruned one, and
 * pruning would promote what it removed. It is the same argument
 * `frequency.ts` makes for unknown words, one order up.
 *
 * Format (after Brotli): the front-coded word list from `frontcode.ts`, then a
 * u32 pair count, then per head word — in that same sorted order — a varint
 * count followed by that many delta-coded tail ids, and finally one quantized
 * PMI byte per pair in the same order.
 */

import { decodeFrontCodedAt } from "./frontcode.ts";

/** First word -> second word -> association strength in [0,1]. */
export type BigramTable = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Maximum PMI the artifact represents, matching `MAX_PMI` in the builder.
 *
 * Only used to document what a score of 1 means; the decoder returns the
 * normalized value, and the one caller multiplies it by a tuned weight.
 */
export const MAX_PMI = 6;

export function decodeBigramTable(bytes: Uint8Array): BigramTable {
  const { words, offset } = decodeFrontCodedAt(bytes, 0);
  let at = offset;
  if (bytes.length - at < 4) {
    throw new Error("bigram artifact is truncated: no pair count");
  }
  const pairs =
    bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24);
  at += 4;

  // Two passes over the same byte range: the first walks the varint stream to
  // find where it ends, because the score bytes start there and nothing in the
  // header records the length. Cheaper than storing an offset that could
  // disagree with the data.
  const heads: Array<{ head: string; tails: number[] }> = [];
  for (const head of words) {
    const count = readVarint(bytes, at);
    at = count.offset;
    const tails: number[] = [];
    let previous = 0;
    for (let i = 0; i < count.value; i++) {
      const delta = readVarint(bytes, at);
      at = delta.offset;
      previous += delta.value;
      tails.push(previous);
    }
    if (tails.length) heads.push({ head, tails });
  }

  if (bytes.length - at < pairs) {
    throw new Error(
      `bigram artifact is truncated: ${pairs} pairs but ${bytes.length - at} score bytes`,
    );
  }

  const table = new Map<string, Map<string, number>>();
  let score = at;
  for (const { head, tails } of heads) {
    const row = new Map<string, number>();
    for (const tail of tails) {
      const word = words[tail];
      if (word === undefined) throw new Error(`bigram artifact references word ${tail} of ${words.length}`);
      row.set(word, bytes[score++]! / 255);
    }
    table.set(head, row);
  }
  return table;
}

/** Unsigned LEB128, mirroring `varint()` in the builder. */
function readVarint(bytes: Uint8Array, start: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (;;) {
    const byte = bytes[offset++];
    if (byte === undefined) throw new Error("bigram artifact is truncated mid-varint");
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7;
    if (shift > 35) throw new Error("bigram artifact has an over-long varint");
  }
}

/**
 * Association between two adjacent words, in [0,1].
 *
 * Returns 0 for a pair the table does not carry, which is the whole reason the
 * artifact stores PMI: zero is the neutral value, so an unseen pair is neither
 * rewarded nor punished and pruning the table cannot change a ranking in the
 * wrong direction.
 */
export function bigramScore(
  table: BigramTable | undefined,
  previous: string,
  next: string,
): number {
  return table?.get(previous)?.get(next) ?? 0;
}

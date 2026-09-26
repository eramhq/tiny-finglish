/**
 * Vowel agreement — the evidence a typed `a` carries that the script drops.
 *
 * A typed `a` is ا or nothing, so `salam` reaches both سلام ("hello") and سالم
 * ("healthy"). Each has one ا and one unwritten vowel, and the channel in
 * `dictionary.ts` scores them identically; frequency then decides, and the
 * table is counted over written Persian, where سالم is the more common word.
 * What separates them is the vowel neither spelling writes: سالم is *sālem*,
 * so `salam` has an `a` where the word has an `e`. That is evidence against it,
 * and this module is the term that uses it.
 *
 * It is the same mechanism as the largest error category in
 * `docs/error-taxonomy.md` — long vowels, "ا-or-nothing for a typed `a` in a
 * word the frequency table does not settle" — and an oracle allowed to flip only
 * ا-placement among candidates the engine already offers puts its ceiling at
 * +1.7 dev / +4.0 fixtures on the rules tier: a ranking problem, not a
 * generation one.
 *
 * Built by `training/tiny_finglish_training/build_vowels.py` from HomoRich
 * (CC0-1.0). Only words that share their skeleton with another table word once
 * ا/آ is removed, and whose vowels differ from it, are stored: that is the one
 * choice a typed `a` leaves open.
 *
 * Format (after Brotli): the front-coded word list from `frontcode.ts`, then
 * one vowel string per word in the same order — ASCII over `aeoAiu` (a/e/o
 * short, A/i/u long), each ended by a newline.
 */

import { decodeFrontCodedAt } from "./frontcode.ts";
import type { Candidate } from "./types.ts";

/** Persian word -> its vowels, e.g. سلام -> `aA`, سالم -> `Ae`. */
export type VowelTable = ReadonlyMap<string, string>;

const NEWLINE = 0x0a;

export function decodeVowelTable(bytes: Uint8Array): VowelTable {
  const { words, offset } = decodeFrontCodedAt(bytes, 0);
  const table = new Map<string, string>();
  let at = offset;
  for (const word of words) {
    let vowels = "";
    for (;;) {
      const byte = bytes[at++];
      if (byte === undefined) {
        throw new Error(`vowel artifact is truncated: ${table.size} of ${words.length} vowel strings`);
      }
      if (byte === NEWLINE) break;
      vowels += String.fromCharCode(byte);
    }
    table.set(word, vowels);
  }
  return table;
}

/**
 * What each typed vowel may stand for.
 *
 * `a` is the ambiguous one — ا or an unwritten short vowel — and `aa` is only
 * ا. The rest follow the usual Finglish habits. A vowel run with no settled
 * reading (`ai`, `ei`, `ia`, ...) matches anything: it is one vowel slot, with
 * no evidence about which.
 */
const TYPED: Readonly<Record<string, string>> = {
  a: "Aa",
  aa: "A",
  e: "e",
  o: "o",
  i: "i",
  ee: "i",
  ii: "i",
  y: "i",
  u: "u",
  oo: "u",
  ou: "u",
  uu: "u",
};
const ANY = "aeoAiu";
const LATIN_VOWEL = /[aeiou]/;

/**
 * The typed word's vowel slots, as the set of vowels each may stand for.
 *
 * `y` is a vowel only between consonants (`khyli`); next to a vowel it is the
 * consonant ی (`yek`, `key`).
 */
export function typedVowels(latin: string): string[] {
  const word = latin.toLowerCase();
  const slots: string[] = [];
  let run = "";
  const flush = () => {
    if (run) slots.push(TYPED[run] ?? ANY);
    run = "";
  };
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]!;
    const vowel = LATIN_VOWEL.test(ch) ||
      (ch === "y" && !LATIN_VOWEL.test(word[i - 1] ?? "") && !LATIN_VOWEL.test(word[i + 1] ?? "") && i > 0);
    if (vowel) run += ch;
    else flush();
  }
  flush();
  return slots;
}

/**
 * How many of a word's vowels the typed ones contradict, after aligning them.
 *
 * An edit distance over vowel slots: a typed vowel the word's vowel is not in
 * the set for costs 1, and so does a typed vowel the word does not have at all
 * — `saham` against سهم (*sahm*), `ashegh` against عشق (*eshq*), `ghatar`
 * against قطر. A word vowel the typist left out is free, because dropping a
 * short vowel is ordinary typing and says nothing about which spelling was
 * meant.
 *
 * The first version scored any count mismatch 0, on the reasoning that an
 * epenthetic vowel (`sabr` typed `saber`) is noise too. It is, but it charges
 * every member of a group alike, so it cancels in `vowelPass`; what the zero
 * threw away was the extra-vowel case above, which is the largest class of ا
 * error the term can reach. With it, the term did not pay at all — rules
 * dev-faithful 69.5 at 0 and at 3 nats, which is the stop rule this term was
 * built under. Measured at the shipped weight, dev-faithful / fixtures:
 *
 *                   off           count mismatch = 0   edit distance
 *     rules         69.5 / 84.3   69.5 / 86.8          69.8 / 87.5
 *     model (v7)    67.6 / 90.9   67.6 / 93.4          67.8 / 93.7
 *     hybrid (v7)   69.1 / 90.9   68.9 / 93.1          69.2 / 93.4
 *
 * Charging a dropped word vowel as well, at 0.5 or 1, moved nothing by more
 * than 0.1, so the simpler rule stands.
 */
export function vowelMismatches(typed: readonly string[], vowels: string): number {
  let previous = Array.from({ length: vowels.length + 1 }, () => 0);
  for (let i = 1; i <= typed.length; i++) {
    const row = [i];
    for (let j = 1; j <= vowels.length; j++) {
      const agree = typed[i - 1]!.includes(vowels[j - 1]!);
      row.push(Math.min(previous[j - 1]! + (agree ? 0 : 1), previous[j]! + 1, row[j - 1]!));
    }
    previous = row;
  }
  return previous[vowels.length]!;
}

/** The confusable group a word belongs to: its spelling with ا and آ removed. */
function alefGroup(word: string): string {
  return word.replace(/[اآ]/gu, "");
}

/**
 * Rerank one word's candidates by vowel agreement.
 *
 * Only candidates in the same confusable group are compared, and the term only
 * ever *charges*: a member is multiplied by `exp(-weight x excess)`, where
 * `excess` is how many more vowels it contradicts than the best-agreeing member
 * of its group, and the list is then renormalized. The best-agreeing member and
 * every candidate outside a group keep their relative standing exactly.
 *
 * The first version redistributed the group's probability mass instead —
 * penalized members' share went to the agreeing ones — and it wrote `ghalat`
 * as غلات: غلات took the mass of its groupmate غلت and overtook غلط, which is in
 * no group and about which the term knows nothing. Evidence *against* one
 * spelling is not evidence *for* its neighbour over a third word. Penalty-only
 * fixed that and measured equal or better on every tier (the sweep is at
 * `SCORING.vowelAgreement`).
 *
 * Context-free — a function of the typed word and its candidate list — so it
 * runs before the word memo and the memo stays valid.
 */
export function vowelPass(
  latin: string,
  candidates: readonly Candidate[],
  table: VowelTable,
  weight: number,
): Candidate[] {
  if (!weight || candidates.length < 2) return [...candidates];
  const typed = typedVowels(latin);
  const groups = new Map<string, number[]>();
  candidates.forEach((candidate, i) => {
    if (!table.has(candidate.output)) return;
    const key = alefGroup(candidate.output);
    const members = groups.get(key);
    if (members) members.push(i);
    else groups.set(key, [i]);
  });

  const probability = candidates.map((c) => c.probability);
  const penalties = new Map<number, number>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const misses = members.map((i) => vowelMismatches(typed, table.get(candidates[i]!.output)!));
    const least = Math.min(...misses);
    members.forEach((i, k) => {
      const excess = misses[k]! - least;
      if (!excess) return;
      probability[i] = Math.max(probability[i]!, 1e-6) * Math.exp(-weight * excess);
      penalties.set(i, excess);
    });
  }
  if (!penalties.size) return [...candidates];
  const total = probability.reduce((a, b) => a + b, 0);

  return candidates
    .map((candidate, i) => ({
      ...candidate,
      probability: Math.round((probability[i]! / total) * 10000) / 10000,
      reason: penalties.has(i)
        ? `${candidate.reason} -${(weight * penalties.get(i)!).toFixed(2)} vowels`
        : candidate.reason,
    }))
    .map((candidate, i) => ({ candidate, i }))
    .sort((a, b) => b.candidate.probability - a.candidate.probability || a.i - b.i)
    .map(({ candidate }) => candidate);
}

/**
 * The naive letter-substitution floor.
 *
 * Greedy longest-match over the Latin units, taking each unit's highest-weight
 * Persian. No beam, no segmentation search, no lexicon, no frequency, no
 * context — one pass, one answer, no confidence.
 *
 * This exists to give the comparison page a genuine floor. Claiming the rule
 * baseline is "the simple approach" overstates it: it searches eight
 * segmentations and keeps a 24-wide beam ranked by a letter prior, which is
 * already a real algorithm. This is what a character map actually gets you, and
 * the gap between this and `RuleBaseline` is the value of that search.
 *
 * It is deliberately *not* re-exported from `index.ts`, for the same reason
 * `metrics.ts` is not: it is an evaluation artifact and should cost the
 * published package nothing.
 */

import { buildReverseTable, LATIN_UNITS, positionOf } from "./rules.ts";

const TABLE = buildReverseTable();

/**
 * Greedy longest-match segmentation — no backtracking.
 *
 * `LATIN_UNITS` is sorted longest-first, so the first match is the longest one.
 * Where nothing matches, one character is consumed so the walk always
 * terminates. This is the cheap cousin of `segment()`, which enumerates every
 * valid segmentation; taking only the first is exactly the corner being cut.
 */
function segmentGreedy(word: string): string[] {
  const units: string[] = [];
  for (let i = 0; i < word.length; ) {
    const unit = LATIN_UNITS.find((u) => word.startsWith(u, i)) ?? word[i]!;
    units.push(unit);
    i += unit.length;
  }
  return units;
}

/** Convert one Latin word, taking the most likely Persian for each unit. */
export function naiveWord(word: string): string {
  const units = segmentGreedy(word.toLowerCase());
  return units
    .map((unit, i) => TABLE.get(unit)?.get(positionOf(i, units.length))?.[0]?.fa ?? unit)
    .join("");
}

/**
 * Convert every Latin run in the text.
 *
 * There is no tokenizer here on purpose: URLs, emails and English words are
 * Latin runs like any other and get converted along with everything else. That
 * is the floor's other failure mode, and the comparison page measures it.
 */
export function naiveTransliterate(text: string): string {
  return text.replace(/[A-Za-z']+/g, naiveWord);
}

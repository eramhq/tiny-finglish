/**
 * Evaluation metrics, shared by the CLI harness and the playground.
 *
 * Lives in `src/` rather than `scripts/` for one reason: the playground runs
 * the fixture suite in the browser, and it must score it *identically* to
 * `node scripts/run-fixtures.ts`. Two implementations would drift, and the
 * first symptom would be a demo page quoting numbers the repo cannot reproduce.
 *
 * Deliberately dependency-free — no `node:` imports — so it bundles for the
 * browser. It is not re-exported from `index.ts`, so it costs the published
 * package nothing unless a consumer asks for it.
 */

const ZWNJ = "‌";

/**
 * Word-level accuracy, computed by edit distance rather than by position.
 *
 * This is the metric the transliteration literature reports. Two details are
 * load-bearing, and getting either wrong understates the score badly:
 *
 * **Alignment must tolerate insertions and deletions.** Persian writes می‌کنی
 * as one token with a ZWNJ and می کنی as two with a space, and real corpora mix
 * both freely. Comparing position-by-position means one such difference shifts
 * every later word and marks the rest of the sentence wrong — on the real gold
 * set that alone cost about seven points of apparent accuracy.
 *
 * **ZWNJ folds to a space before splitting**, on both sides, because real
 * corpora are not internally consistent about it: می‌کنی is one token with a
 * ZWNJ and می کنی is two with a space, and both occur. ZWNJ placement is still
 * measured, separately, against references that agree with themselves.
 *
 * Know what that fold costs on the collected gold set, because it is not zero.
 * **Not one of its 1,835 references contains a ZWNJ** — its Persian side comes
 * from a pipeline that never emits one, where ordinary Persian puts one in
 * about 23% of word types. So a correct می‌کنم folds to two words against a
 * reference that spells میکنم solid, and scores as a miss. Measured: folding
 * ZWNJ *away* instead of to a space moves the model from 51.2% to 54.3% on
 * gold and leaves the rule baseline, which emits none, at 62.3%. The fold is
 * kept as it is — it is the published metric and it is right for a corpus that
 * mixes both conventions — but any comparison between a ZWNJ-emitting engine
 * and one that cannot emit ZWNJ is reading a three-point handicap on this data.
 *
 * **Punctuation folds the same way, for the same reason.** The gold's Persian
 * side glues marks to words — `کردم،`, `میکند.` — so a correct `کردم` was
 * scored wrong against a reference that carries a comma we deliberately emit as
 * its own span. The effect is specific to the collected data, which is the
 * evidence that it is an artifact and not a way of flattering every number:
 * folding moves the author-written sets by +0.54 and +0.00 and the real gold by
 * +3.32. Punctuation localization is still measured, separately, in
 * `scripts/_report.ts`.
 */
export function wordAccuracy(
  reference: string,
  hypothesis: string,
): { correct: number; total: number } {
  const ref = splitWords(reference);
  const hyp = splitWords(hypothesis);
  if (ref.length === 0) return { correct: 0, total: hyp.length };

  let previous = Array.from({ length: hyp.length + 1 }, (_, i) => i);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  // Errors cannot exceed the reference length, so accuracy stays in [0,1].
  const errors = Math.min(previous[hyp.length]!, ref.length);
  return { correct: ref.length - errors, total: ref.length };
}

/**
 * Marks folded to a separator before splitting.
 *
 * Latin and Persian sentence punctuation, brackets, quotes and dashes. The
 * ASCII `"` and `-` are here because the gold carries 26 and 25 of them
 * respectively, glued to Persian words exactly as the commas are; leaving
 * either out loses 0.17 points to the same artifact the rest of the class
 * fixes. Digits are *not* here — a wrong digit is a wrong word.
 */
const FOLDED_MARKS = /[.,!?;:()[\]{}"'\-\u060C\u061B\u061F\u00AB\u00BB\u2014\u2013\u2026]/gu;

/**
 * Split into comparable words, treating ZWNJ and punctuation as separators.
 *
 * Marks fold to a space rather than to nothing, so a glued `نه،میخام` splits
 * into the two words it represents instead of fusing into one that matches
 * neither.
 *
 * Exported so that anything defining a rule *about* the headline metric — the
 * CER threshold that quarantined `data/gold/gold-misaligned.jsonl`, say — can
 * state it in the metric's own terms rather than re-deriving the fold.
 */
export function splitWords(text: string): string[] {
  return text
    .replace(new RegExp(ZWNJ, "gu"), " ")
    .replace(FOLDED_MARKS, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Levenshtein distance normalized by reference length. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  if (reference === hypothesis) return 0;
  if (!reference.length) return hypothesis.length ? 1 : 0;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length]! / reference.length;
}

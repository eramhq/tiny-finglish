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
 * **ZWNJ folds to a space before splitting**, on both sides, because the gold
 * source is not internally consistent about it. ZWNJ placement is still
 * measured, separately, against references that agree with themselves.
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

/** Split into comparable words, treating ZWNJ as a separator. */
function splitWords(text: string): string[] {
  return text.replace(new RegExp(ZWNJ, "gu"), " ").split(/\s+/).filter(Boolean);
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

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
  split: (text: string) => string[] = splitWords,
): { correct: number; total: number } {
  const ref = split(reference);
  const hyp = split(hypothesis);
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
 * Word accuracy against the closest of several accepted references.
 *
 * The chat sets list, per message, the other spellings of the same words that
 * are equally correct in chat — آره/اره, میخوام/می‌خوام. The strict metric
 * scores against `references[0]` alone; this is the
 * tier that stops a legitimate variant from costing a word. Errors are counted
 * against each reference, the fewest win, and the total is the first
 * reference's, so the two tiers share a denominator.
 */
export function acceptedWordAccuracy(
  references: readonly string[],
  hypothesis: string,
  split: (text: string) => string[] = splitWords,
): { correct: number; total: number } {
  const first = wordAccuracy(references[0] ?? "", hypothesis, split);
  let errors = first.total - first.correct;
  for (const reference of references.slice(1)) {
    const w = wordAccuracy(reference, hypothesis, split);
    errors = Math.min(errors, w.total - w.correct);
  }
  return { correct: Math.max(0, first.total - errors), total: first.total };
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
 * Three or more of one Persian letter: a chat stretch, مرسیییی. No Persian
 * word spells a letter three times running, so this never merges two words.
 */
const STRETCH = /(?=\p{Script=Arabic})(\p{L})\1{2,}/gu;

/**
 * Split into comparable words, treating ZWNJ and punctuation as separators.
 *
 * Marks fold to a space rather than to nothing, so a glued `نه،میخام` splits
 * into the two words it represents instead of fusing into one that matches
 * neither.
 *
 * **A stretch folds to one letter**, on both sides: مرسیییی and مرسی are one
 * word, emphasised. The engine writes the stretch back when the typist
 * stretched (`src/stretch.ts`) and the chat references mostly drop it, so
 * without the fold keeping the emphasis would cost a word. It is a metric
 * correction and was measured as one, alone, on the engine before stretches
 * were handled: 0.0 on dev and the fixtures, +0.2 to +0.3 on chat-dev
 * (AI-typed), where the engines already wrote `merciii` as مرسییی.
 *
 * Exported so that anything defining a rule *about* the headline metric — the
 * CER threshold that quarantined `data/gold/gold-misaligned.jsonl`, say — can
 * state it in the metric's own terms rather than re-deriving the fold.
 */
export function splitWords(text: string): string[] {
  return text
    .replace(new RegExp(ZWNJ, "gu"), " ")
    .replace(FOLDED_MARKS, " ")
    .replace(STRETCH, "$1")
    .split(/\s+/)
    .filter(Boolean);
}

/** Verbal prefixes Persian writes solid, with a space, or with a ZWNJ. */
const JOINING_PREFIXES: ReadonlySet<string> = new Set(["می", "نمی"]);

/** Plural, ezafe, personal-ending and comparative suffixes with the same freedom. */
const JOINING_SUFFIXES: ReadonlySet<string> = new Set(
  ["ها", "های", "ای", "ام", "ایم", "اید", "اند", "تر", "ترین"],
);

/** آ and hamza-alef to bare alef; every digit family to ASCII. */
function foldOrthography(word: string): string {
  return word.replace(/[آأإ]/gu, "ا").replace(/[۰-۹٠-٩]/gu, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The *orthographic* tier's split: `splitWords`, then fold the spelling
 * conventions Persian writers genuinely disagree on.
 *
 * This is the headline tier. No evaluation reference writes ZWNJ, so the strict
 * tier charges an engine for writing می‌کنم correctly, and only this one
 * compares such an engine fairly with one that cannot write the half-space.
 * It is deliberately narrow: آ/ا (`آن`/`ان` is a convention, not a different word to a
 * reader), digits of any script, and the verbal prefixes and suffixes that are
 * written solid, spaced or ZWNJ-joined interchangeably — `میکنم`, `می کنم` and
 * `می‌کنم` are one word three ways, and so are `کتابها` and `کتاب ها`.
 *
 * Joining runs on both sides, so it never *creates* a match between different
 * words; it only stops a spacing choice from costing two errors. What it does
 * not fold is anything that changes which word was written: ع, long vowels,
 * homophone consonants, register. Those are the judged tier's business
 * (`scripts/judge.ts`), and a model should not get a deterministic metric that
 * waves them through.
 */
export function lenientSplitWords(text: string): string[] {
  const out: string[] = [];
  let prefix = "";
  for (const raw of splitWords(text)) {
    const word = foldOrthography(raw);
    if (JOINING_PREFIXES.has(word)) {
      prefix += word;
      continue;
    }
    if (!prefix && JOINING_SUFFIXES.has(word) && out.length > 0) {
      out[out.length - 1] += word;
      continue;
    }
    out.push(prefix + word);
    prefix = "";
  }
  if (prefix) out.push(prefix);
  return out;
}

/** How many words, at most, one written-solid word may stand for on the other side. */
const MAX_JOIN = 3;

/**
 * True when `solid` is `words` written as one: their letters joined, or with
 * the ه of a leading به or چه dropped, as Persian drops it when it writes them
 * solid — به دست and بدست, چه قدر and چقدر, به عنوان and بعنوان.
 */
export function writtenAsOne(solid: string, words: readonly string[]): boolean {
  const joined = words.join("");
  if (solid === joined) return true;
  return words.length > 1 && (words[0] === "به" || words[0] === "چه") && solid === words[0][0] + joined.slice(2);
}

/**
 * The headline tier: `lenientSplitWords` on both sides, and compound spacing
 * forgiven.
 *
 * Persian writes many compounds solid, spaced or with a ZWNJ: زمانیکه, زمانی
 * که and زمانی‌که; راهحل and راه حل; کارافرین and کار افرین. The evaluation
 * references join what a ZWNJ once separated (their Persian had its ZWNJ
 * stripped), so an engine that writes the standard spaced or half-spaced
 * form loses a word, or two, to a spacing convention. Here the alignment may
 * match one word against two or three consecutive words on the other side
 * whose letters, joined, are that word, at no cost. Everything else is charged
 * exactly as `wordAccuracy` charges it, so a sentence with a spacing
 * difference next to a real mistake still pays for the mistake.
 *
 * It never matches different letters: the join is exact, after the folds
 * `lenientSplitWords` already makes. Measured on dev before it became the
 * headline, as the `spacing` group of `scripts/error-groups.ts`.
 *
 * The one exception is the ه of a leading به or چه (`writtenAsOne`): Persian
 * writes بدست and به دست, چقدر and چه قدر, and both real references use the
 * solid forms where typists typed them apart. It was 47 of the hybrid's 230
 * engine errors on dev that were not vowels, ه or homophones, and forgiving
 * it moved the dev headline +0.9 (rules) and +1.0 (hybrid), chat-dev and the
 * fixtures not at all.
 */
export function orthographicWordAccuracy(reference: string, hypothesis: string): { correct: number; total: number } {
  const ref = lenientSplitWords(reference);
  const hyp = lenientSplitWords(hypothesis);
  if (ref.length === 0) return { correct: 0, total: hyp.length };
  const d: number[][] = Array.from({ length: ref.length + 1 }, (_, i) =>
    Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= ref.length; i++) {
    for (let j = 1; j <= hyp.length; j++) {
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
      for (let k = 2; k <= MAX_JOIN; k++) {
        if (j >= k && writtenAsOne(ref[i - 1]!, hyp.slice(j - k, j))) best = Math.min(best, d[i - 1]![j - k]!);
        if (i >= k && writtenAsOne(hyp[j - 1]!, ref.slice(i - k, i))) best = Math.min(best, d[i - k]![j - 1]!);
      }
      d[i]![j] = best;
    }
  }
  const errors = Math.min(d[ref.length]![hyp.length]!, ref.length);
  return { correct: ref.length - errors, total: ref.length };
}

/** One contiguous run of non-matching words in the minimum word alignment. */
export interface MismatchSpan {
  /** Reference words `[refStart, refEnd)`. */
  refStart: number;
  refEnd: number;
  /** Hypothesis words `[hypStart, hypEnd)`. */
  hypStart: number;
  hypEnd: number;
  /** Edit operations inside the run; the spans' costs sum to the distance. */
  cost: number;
}

/**
 * The word alignment `wordAccuracy` scores, as the runs of words it charged.
 *
 * `scripts/judge.ts` sends each run to LLM judges, which decide whether it is an
 * acceptable variant; the judged tier then refunds that run's cost. Backtrace
 * prefers a match, then a substitution, then a deletion, so a run is as short
 * as the distance allows and the refund can never exceed what was charged.
 */
export function wordMismatches(ref: readonly string[], hyp: readonly string[]): MismatchSpan[] {
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
  }

  // Backtrace into one op per step: 0 match, 1 substitute, 2 delete, 3 insert.
  const ops: Array<{ op: number; i: number; j: number }> = [];
  let i = ref.length;
  let j = hyp.length;
  while (i > 0 || j > 0) {
    const here = d[i]![j]!;
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && here === d[i - 1]![j - 1]) {
      ops.push({ op: 0, i: --i, j: --j });
    } else if (i > 0 && j > 0 && here === d[i - 1]![j - 1]! + 1) {
      ops.push({ op: 1, i: --i, j: --j });
    } else if (i > 0 && here === d[i - 1]![j]! + 1) {
      ops.push({ op: 2, i: --i, j });
    } else {
      ops.push({ op: 3, i, j: --j });
    }
  }
  ops.reverse();

  const spans: MismatchSpan[] = [];
  let current: MismatchSpan | undefined;
  for (const { op, i: at, j: to } of ops) {
    if (op === 0) {
      current = undefined;
      continue;
    }
    if (!current) {
      current = { refStart: at, refEnd: at, hypStart: to, hypEnd: to, cost: 0 };
      spans.push(current);
    }
    if (op !== 3) current.refEnd = at + 1;
    if (op !== 2) current.hypEnd = to + 1;
    current.cost++;
  }
  return spans;
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

/**
 * Where the missing accuracy actually is: ranking, or generation?
 *
 *     node scripts/oracle.ts              # both measurements, gold
 *     node scripts/oracle.ts --fixtures   # ...on the fixtures instead
 *     node scripts/oracle.ts --dev        # ...on the dev set, the one to tune against
 *     node scripts/oracle.ts --verbose    # list the split-digraph misses
 *     node scripts/oracle.ts --misses     # what the never-proposed words are
 *
 * Two numbers, and the whole ordering of the roadmap turns on them.
 *
 * **Oracle recall.** Take every span's top-`k` candidate list and ask how often
 * the reference word is in it *anywhere*. The gap between top-1 and that oracle
 * is what a perfect reranker — a language model, at best — could recover. What
 * is left over is never proposed at all, and no amount of reranking can reach
 * it; only generating better candidates can.
 *
 * The repository's own stated diagnosis was that the bottleneck is the missing
 * sentence-context language model, citing prior art where context moved word
 * error 33.8% -> 12.2%. That prior art sat on top of a pair 6-gram FST, a far
 * richer generator than this one. This script is how that citation gets checked
 * against this system rather than assumed to transfer.
 *
 * **Split-digraph cost.** The unit prior in `RuleBaseline.walk()` is a sum of
 * per-unit log probabilities with no term for the number of units, so a
 * segmentation is free to use more of them. `gh` -> ق carries w=40 while g -> گ
 * (60) and h -> ه (100) are individually commoner, so `g`+`h` outscores `gh` on
 * prior alone and `vaaghean` comes out واگهن. This counts the words that lands
 * on, by asking of every wrong word whether undoing exactly one split repairs
 * it — a rule that names no digraph in particular and so keeps working if the
 * table changes.
 *
 * **`--misses` is the follow-up that matters most.** Knowing that 20% of words
 * are never proposed says nothing about whether *proposing more* would help.
 * Classifying them says it does not: the bucket is dominated by references that
 * are in a different register than the input (`khaane` against خونه), by rows
 * whose words do not correspond despite matching counts, and by ع, which
 * Finglish does not write. Under 1% differ from our answer only by a homophone
 * letter class or an alef form — the part a better generator could reach.
 *
 * All read-only reports. None of them tunes anything: see docs/contributing.md.
 */
import { normalize } from "../src/normalize.ts";
import { splitWords } from "../src/metrics.ts";
import { buildReverseTable, LATIN_UNITS, positionOf } from "../src/rules.ts";
import { buildTransliterator, loadFixtures, type Fixture } from "./_load.ts";
import type { Span } from "../src/types.ts";

const argv = process.argv.slice(2);
const FILE = argv.includes("--fixtures")
  ? "data/fixtures/fixtures.jsonl"
  : argv.includes("--dev") ? "data/dev/dev.jsonl" : "data/gold/gold.jsonl";
const VERBOSE = argv.includes("--verbose");
const MISSES = argv.includes("--misses");

/**
 * The candidate budget the oracle is measured at.
 *
 * Deliberately wider than `DEFAULT_OPTIONS` in `src/index.ts`: the question is
 * what a reranker *could* reach, so the generator is given room. Anything not
 * in this list at this width is not a ranking failure.
 */
const ORACLE = { candidatesPerSpan: 8, beamWidth: 16 } as const;

// --------------------------------------------------------------- alignment

/**
 * Sentences where spans and reference words line up one to one.
 *
 * Restricting to these is what makes a per-word oracle meaningful: without a
 * 1:1 correspondence there is no "the candidate list for this reference word".
 * It biases the sample toward easier sentences, which is fine — the oracle is
 * an upper bound on what reranking buys, and an optimistic sample only makes
 * that bound more generous.
 */
function align(spans: readonly Span[], reference: readonly string[]): Span[] | null {
  const words = spans.filter((s) => s.action === "convert" || s.action === "copy");
  if (words.length !== reference.length) return null;
  if (words.some((s) => s.action === "copy")) return null;
  return words;
}

// ------------------------------------------------------------ split digraph

/**
 * Multi-character Latin units, paired with the Persian their split spells.
 *
 * Derived from the same reverse table the baseline walks, so it stays true if
 * the correspondences change. `gh` -> {ق, غ} against `g`+`h` -> گه, and so on
 * for every digraph the table admits.
 */
function splitDigraphs(): Array<{ unit: string; merged: string[]; split: string[] }> {
  const table = buildReverseTable();
  const out: Array<{ unit: string; merged: string[]; split: string[] }> = [];
  for (const unit of LATIN_UNITS) {
    if (unit.length < 2) continue;
    const seen = new Set<string>();
    for (const position of ["initial", "medial", "final"] as const) {
      for (const c of table.get(unit)?.get(position) ?? []) if (c.fa) seen.add(c.fa);
    }
    if (seen.size === 0) continue;
    const merged = [...seen];

    // Every way of spelling the same Latin run as separate units, taking each
    // sub-unit's most likely Persian. One level deep is enough: the defect is a
    // digraph losing to its own two letters, not a general search.
    const split = new Set<string>();
    for (let cut = 1; cut < unit.length; cut++) {
      const parts = [unit.slice(0, cut), unit.slice(cut)];
      const spelled = parts.map((part, i) => {
        const choices = table.get(part)?.get(positionOf(i, parts.length)) ?? [];
        return choices[0]?.fa ?? null;
      });
      if (spelled.every((x) => x !== null) && spelled.join("")) split.add(spelled.join(""));
    }
    // A split must actually spell out more letters than the digraph does.
    // Without this, `oo` contributes a one-character "split" of ا — its final
    // `o` takes the empty label — and the repair rule degenerates into "any
    // ا that should have been و", which is vowel length and register, not
    // segmentation. That false positive was 60% of the first count.
    const only = [...split].filter(
      (s) => s.length >= 2 && !seen.has(s) && merged.some((m) => s.length > m.length),
    );
    if (only.length) out.push({ unit, merged, split: only });
  }
  return out;
}

const DIGRAPHS = splitDigraphs();

/**
 * Does this wrong word carry a split spelling the reference contradicts?
 *
 * The weaker of the two attributions, and an upper bound: the split is present
 * and wrong, but the word may be wrong for other reasons too, so fixing the
 * segmentation alone would not necessarily score it correct.
 */
function implicatesSplit(reference: string, hypothesis: string): boolean {
  return DIGRAPHS.some(
    ({ merged, split }) =>
      split.some((wrong) => hypothesis.includes(wrong)) &&
      merged.some((right) => reference.includes(right)),
  );
}

/**
 * The merged spelling this wrong word would need to become the right one.
 *
 * The stronger attribution, and a lower bound: undoing exactly one split turns
 * this word from wrong into right, so the segmentation is the *only* error.
 */
function repairedBySplit(reference: string, hypothesis: string): string | null {
  for (const { unit, merged, split } of DIGRAPHS) {
    for (const wrong of split) {
      if (!hypothesis.includes(wrong)) continue;
      for (const right of merged) {
        if (wrong.length <= right.length) continue;
        // One occurrence at a time: two independent splits in one word is a
        // different failure and should not be credited to this one.
        let from = hypothesis.indexOf(wrong);
        while (from >= 0) {
          const repaired = hypothesis.slice(0, from) + right + hypothesis.slice(from + wrong.length);
          if (repaired === reference) return `${unit}: ${wrong} -> ${right}`;
          from = hypothesis.indexOf(wrong, from + 1);
        }
      }
    }
  }
  return null;
}

// -------------------------------------------------------------------- run

interface Row {
  label: string;
  sentences: number;
  words: number;
  top1: number;
  oracle: number;
  splitWords: number;
  splitPoints: number;
  implicated: number;
  implicatedPoints: number;
  examples: string[];
}

function measure(label: string, useModel: boolean, cases: readonly Fixture[]): Row {
  const transliterator = buildTransliterator({ model: useModel });
  const row: Row = { label, sentences: 0, words: 0, top1: 0, oracle: 0, splitWords: 0, splitPoints: 0, implicated: 0, implicatedPoints: 0, examples: [] };
  let allWords = 0;

  for (const testCase of cases) {
    if (testCase.expected === null) continue;
    const reference = splitWords(normalize(testCase.expected));
    const result = transliterator.transliterate(testCase.input, ORACLE);
    allWords += reference.length;

    // The split-digraph cost is measured over *every* sentence, aligned or not:
    // it is a property of the output, and restricting it to the aligned subset
    // would understate it by the share of sentences the oracle cannot use.
    const got = splitWords(normalize(result.text));
    for (let i = 0; i < Math.min(got.length, reference.length); i++) {
      if (got[i] === reference[i]) continue;
      if (implicatesSplit(reference[i]!, got[i]!)) row.implicated++;
      const repair = repairedBySplit(reference[i]!, got[i]!);
      if (!repair) continue;
      row.splitWords++;
      if (row.examples.length < 12) {
        row.examples.push(`${testCase.id}  ${got[i]} -> ${reference[i]}   (${repair})`);
      }
    }

    const spans = align(result.spans, reference);
    if (!spans) continue;
    row.sentences++;
    row.words += reference.length;
    spans.forEach((span, i) => {
      const candidates = span.candidates ?? [{ output: span.output, probability: 1, reason: "" }];
      if (candidates[0]?.output === reference[i]) row.top1++;
      if (candidates.some((c) => c.output === reference[i])) row.oracle++;
    });
  }
  // Report the split cost against the whole set, which is the denominator the
  // headline word accuracy uses.
  row.splitPoints = (row.splitWords / allWords) * 100;
  row.implicatedPoints = (row.implicated / allWords) * 100;
  return row;
}

const cases = loadFixtures(FILE);
const rows = [
  measure("rules + frequency", false, cases),
  measure("model + frequency", true, cases),
];

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");

console.log(`dataset=${FILE}  n=${cases.length}  candidatesPerSpan=${ORACLE.candidatesPerSpan}  beamWidth=${ORACLE.beamWidth}`);
console.log("");
console.log("| engine | sentences | words | top-1 | oracle best-of-8 | rerankable | never proposed |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const r of rows) {
  const rerank = ((r.oracle - r.top1) / r.words) * 100;
  const never = ((r.words - r.oracle) / r.words) * 100;
  console.log(
    `| ${r.label} | ${r.sentences} | ${r.words} | ${pct(r.top1, r.words)} | ${pct(r.oracle, r.words)} | ` +
    `**+${rerank.toFixed(1)} pts** | **${never.toFixed(1)}%** |`,
  );
}
console.log("");
console.log("Rerankable is the ceiling on a perfect language model. Never-proposed is the");
console.log("candidate-generation bucket, which no reranker can reach.");
console.log("");
console.log("| engine | wrong words carrying a split spelling | of which one edit repairs outright |");
console.log("|---|---:|---:|");
for (const r of rows) {
  console.log(
    `| ${r.label} | ${r.implicated} (**${r.implicatedPoints.toFixed(2)} pts**) | ` +
    `${r.splitWords} (**${r.splitPoints.toFixed(2)} pts**) |`,
  );
}
console.log("");
console.log("The left column is an upper bound — the split is wrong, and so may other letters");
console.log("be. The right is a lower bound: undoing one split is the whole fix.");
console.log("");
console.log(`digraphs checked: ${DIGRAPHS.map((d) => `${d.unit} (${d.split.join("/")} vs ${d.merged.join("/")})`).join(", ")}`);

if (VERBOSE) {
  for (const r of rows) {
    console.log(`\n--- ${r.label} ---`);
    for (const example of r.examples) console.log(`  ${example}`);
  }
}

// ------------------------------------------------------- what the misses are

/**
 * Why was this reference word never proposed?
 *
 * Ordered most-specific first, so a word that is both in a different register
 * and differs by a long vowel lands in the vowel bucket only if nothing
 * sharper matched. The point of the classification is to separate misses a
 * better *generator* could reach from misses that carry information the input
 * does not contain — and the answer decides whether widening the search is
 * worth anything.
 */
function classifyMiss(want: string, got: string): string {
  const ZWNJ = "\u200C";
  const foldClasses = (x: string) =>
    x.replace(/[سصث]/gu, "s").replace(/[تط]/gu, "t").replace(/[زذضظ]/gu, "z")
      .replace(/[قغ]/gu, "q").replace(/[هح]/gu, "h").replace(/[اآ]/gu, "a");

  if (want.includes(ZWNJ)) return "reference carries a ZWNJ";
  if (/[عءئؤ]/u.test(want) && !/[عءئؤ]/u.test(got)) return "reference carries ع/ء, which Finglish does not write";
  if (want.replace(/[اآ]/gu, "ا") === got.replace(/[اآ]/gu, "ا")) return "alef form only (ا vs آ)";
  if (want.replace(/[وی]/gu, "") === got.replace(/[وی]/gu, "")) return "long vowel و/ی only";
  if (foldClasses(want) === foldClasses(got) && want !== got) return "homophone letter class only";
  if (Math.abs(want.length - got.length) >= 2) return "a different word — the row is not aligned word for word";
  return "other (dominated by formal input against a colloquial reference)";
}

if (MISSES) {
  const transliterator = buildTransliterator({ model: false });
  const counts = new Map<string, number>();
  const examples = new Map<string, string[]>();
  let never = 0;
  let total = 0;

  for (const testCase of cases) {
    if (testCase.expected === null) continue;
    const reference = splitWords(normalize(testCase.expected));
    const result = transliterator.transliterate(testCase.input, ORACLE);
    const spans = align(result.spans, reference);
    if (!spans) continue;
    total += reference.length;
    spans.forEach((span, i) => {
      const want = reference[i]!;
      const candidates = (span.candidates ?? []).map((c) => c.output);
      if (candidates.includes(want)) return;
      never++;
      const tag = classifyMiss(want, candidates[0] ?? "");
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      const shown = examples.get(tag) ?? [];
      if (shown.length < 3) {
        shown.push(`${span.input} -> ${candidates[0] ?? "(none)"}   want ${want}`);
        examples.set(tag, shown);
      }
    });
  }

  console.log("");
  console.log(`--- why ${never} of ${total} reference words are never proposed (rules + frequency) ---`);
  for (const [tag, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(5)}  ${((n / never) * 100).toFixed(1).padStart(5)}%  ${tag}`);
    for (const example of examples.get(tag) ?? []) console.log(`              ${example}`);
  }
}

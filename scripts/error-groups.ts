/**
 * What the remaining errors on dev are, in groups: the engine's fault, or the
 * test's.
 *
 *   node scripts/error-groups.ts                  # the hybrid, the default engine
 *   node scripts/error-groups.ts --engine rules   # or rules | model
 *   node scripts/error-groups.ts --examples 10
 *
 * Dev only: gold is scored once and never read for what to fix next.
 *
 * The engine's own errors are the word runs charged against the row's
 * `faithful` reference, which is `expected` edited to what the typist actually
 * wrote (`میشه` typed as `mishavad`). Each is sorted by the smallest edit that
 * explains it, first match wins: a final ه added or dropped, homophone letters
 * (س/ص/ث, ز/ذ/ض/ظ, ت/ط, ق/غ, ه/ح, ا/ع), long vowels (ا, و, ی added or dropped),
 * a number written in digits against one in words, and everything else.
 *
 * **Reference is not what was typed** is the rest of what the headline
 * (orthographic) tier charges against `expected`: the words the test asked for
 * that nobody typed. It is a net count — the headline charge less the engine's
 * own — because a row can also lose a word against `faithful` that `expected`
 * forgives.
 *
 * Until September 2026 the groups were read off the runs charged against
 * `expected`, and a run went to the engine whole if any word in it was wrong
 * against `faithful`. A formal sentence against a colloquial reference is one
 * long run, so one real mistake inside it charged the engine for the register
 * too: 237 of the 467 words the hybrid's "other" group held on dev.
 *
 * A run whose letters are the same, split or joined differently (زمانیکه,
 * زمانی که, and بدست, به دست — `writtenAsOne`), is compound spacing, which
 * the headline forgives (`orthographicWordAccuracy`); it is counted on its own
 * line and not charged. Counts are in words, the unit the metric charges. They
 * follow the runs of the plain alignment, so the charged total can differ from
 * the tier's by a few words where a spacing difference sits inside a longer
 * run.
 */
import { buildFixtureReport } from "./_report.ts";
import { lenientSplitWords, wordMismatches, writtenAsOne } from "../src/metrics.ts";
import { normalize } from "../src/normalize.ts";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const engine = value("engine") ?? "hybrid";
if (!["rules", "model", "hybrid"].includes(engine)) throw new Error(`--engine is rules, model or hybrid`);
const perGroup = Number(value("examples") ?? 5);

const GROUPS = [
  ["typed", "reference is not what was typed (test)"],
  ["he", "a final ه added or dropped"],
  ["homophone", "homophone letters (س/ص/ث, ز/ذ/ض/ظ, ت/ط, ق/غ, ه/ح, ا/ع)"],
  ["vowel", "long vowels: ا, و or ی added or dropped"],
  ["number", "digits against a number in words"],
  ["other", "other: a different word or form"],
] as const;
type Group = (typeof GROUPS)[number][0];

const HOMOPHONES: Array<[RegExp, string]> = [
  [/[صث]/gu, "س"], [/[ذضظ]/gu, "ز"], [/ط/gu, "ت"], [/غ/gu, "ق"], [/ح/gu, "ه"], [/[عئءأ]/gu, "ا"],
];
const fold = (s: string) => HOMOPHONES.reduce((t, [re, to]) => t.replace(re, to), s);
const noVowels = (s: string) => s.replace(/[اوی]/gu, "");
const solid = (s: string) => s.replace(/\s+/gu, "");

function engineError(ref: string, hyp: string): Exclude<Group, "typed"> {
  if (/\d/u.test(ref) !== /\d/u.test(hyp)) return "number";
  if (ref && hyp && ref.replace(/ه$/u, "") === hyp.replace(/ه$/u, "")) return "he";
  if (ref && hyp && fold(solid(ref)) === fold(solid(hyp))) return "homophone";
  if (ref && hyp && noVowels(fold(solid(ref))) === noVowels(fold(solid(hyp)))) return "vowel";
  return "other";
}

const report = buildFixtureReport({
  useModel: engine !== "rules",
  useHybrid: engine === "hybrid",
  file: "data/dev/dev.jsonl",
});

const counts = new Map<Group, number>(GROUPS.map(([g]) => [g, 0]));
let forgiven = 0;
const examples = new Map<Group, string[]>(GROUPS.map(([g]) => [g, []]));
let charged = 0;
let words = 0;

/**
 * A run's words on each side are one spelling, split or joined differently:
 * each word on one side is one to three words on the other (`writtenAsOne`),
 * in order, as the headline's alignment allows.
 */
function sameWriting(ref: readonly string[], hyp: readonly string[]): boolean {
  if (solid(ref.join(" ")) === solid(hyp.join(" "))) return true;
  const pair = (i: number, j: number): boolean => {
    if (i === ref.length || j === hyp.length) return i === ref.length && j === hyp.length;
    if (ref[i] === hyp[j] && pair(i + 1, j + 1)) return true;
    for (let k = 2; k <= 3; k++) {
      if (j + k <= hyp.length && writtenAsOne(ref[i]!, hyp.slice(j, j + k)) && pair(i + 1, j + k)) return true;
      if (i + k <= ref.length && writtenAsOne(hyp[j]!, ref.slice(i, i + k)) && pair(i + k, j + 1)) return true;
    }
    return false;
  };
  return pair(0, 0);
}

/** The runs the headline charges against `reference`, compound spacing forgiven. */
function* chargedRuns(reference: readonly string[], got: readonly string[], onForgiven?: (cost: number) => void) {
  for (const span of wordMismatches(reference, got)) {
    const ref = reference.slice(span.refStart, span.refEnd);
    const hyp = got.slice(span.hypStart, span.hypEnd);
    if (sameWriting(ref, hyp)) {
      onForgiven?.(span.cost);
      continue;
    }
    yield { ref: ref.join(" "), hyp: hyp.join(" "), cost: span.cost, hypStart: span.hypStart, hypEnd: span.hypEnd };
  }
}

for (const c of report.cases) {
  if (c.fixture.expected === null) continue;
  const expected = lenientSplitWords(normalize(c.fixture.expected));
  const got = lenientSplitWords(normalize(c.result.text));
  words += expected.length;
  const faithful = c.fixture.faithful === undefined ? expected : lenientSplitWords(normalize(c.fixture.faithful));
  let own = 0;
  // Hypothesis words the faithful reference charges; an `expected` run that
  // touches none of them is an example of a word nobody typed.
  const wrong = new Set<number>();
  for (const run of chargedRuns(faithful, got)) {
    const group = engineError(run.ref, run.hyp);
    counts.set(group, counts.get(group)! + run.cost);
    own += run.cost;
    for (let k = run.hypStart; k <= Math.max(run.hypEnd - 1, run.hypStart); k++) wrong.add(k);
    const list = examples.get(group)!;
    if (list.length < perGroup) list.push(`${c.fixture.input.slice(0, 60)}\n      want ${run.ref || "(nothing)"}   got ${run.hyp || "(nothing)"}`);
  }
  let headline = 0;
  for (const run of chargedRuns(expected, got, (cost) => (forgiven += cost))) {
    headline += run.cost;
    let touches = false;
    for (let k = run.hypStart; k <= Math.max(run.hypEnd - 1, run.hypStart); k++) touches ||= wrong.has(k);
    const list = examples.get("typed")!;
    if (!touches && list.length < perGroup) list.push(`${c.fixture.input.slice(0, 60)}\n      want ${run.ref || "(nothing)"}   got ${run.hyp || "(nothing)"}`);
  }
  counts.set("typed", counts.get("typed")! + headline - own);
  charged += headline;
}

console.log(`engine=${engine}  dev, orthographic tier  words=${words}  charged=${charged} ` +
  `(${((100 * (words - charged)) / words).toFixed(1)}% right)  compound spacing forgiven: ${forgiven}\n`);
console.log("| group | words | share of errors | of all words |");
console.log("|---|---:|---:|---:|");
for (const [g, label] of GROUPS) {
  const n = counts.get(g)!;
  console.log(`| ${label} | ${n} | ${((100 * n) / charged).toFixed(1)}% | ${((100 * n) / words).toFixed(1)} pts |`);
}
if (perGroup > 0) {
  for (const [g, label] of GROUPS) {
    console.log(`\n${label}`);
    for (const e of examples.get(g)!) console.log(`  ${e}`);
  }
}

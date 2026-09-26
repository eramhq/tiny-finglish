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
 * Every word run the headline (orthographic) tier charges against `expected`
 * is sorted into one group, first match wins:
 *
 *   * **reference is not what was typed**: the run is right against the row's
 *     `faithful` reference, which is `expected` edited to what the typist
 *     actually wrote (`میشه` typed as `mishavad`). The engine did its job; the
 *     test asked for a word nobody typed.
 *   * then the engine's own errors, by the smallest edit that explains them:
 *     a final ه added or dropped, homophone letters (س/ص/ث, ز/ذ/ض/ظ, ت/ط,
 *     ق/غ, ه/ح, ا/ع), long vowels (ا, و, ی added or dropped), spacing (the
 *     same letters, split or joined differently), a number written in digits
 *     against one in words, and everything else.
 *
 * Counts are in words, the unit the metric charges, and add up to the tier's
 * errors.
 */
import { buildFixtureReport } from "./_report.ts";
import { lenientSplitWords, wordMismatches } from "../src/metrics.ts";
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
  ["spacing", "same letters, split or joined differently"],
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
  if (solid(ref) === solid(hyp) && ref !== hyp) return "spacing";
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
const examples = new Map<Group, string[]>(GROUPS.map(([g]) => [g, []]));
let charged = 0;
let words = 0;

for (const c of report.cases) {
  if (c.fixture.expected === null) continue;
  const expected = lenientSplitWords(normalize(c.fixture.expected));
  const got = lenientSplitWords(normalize(c.result.text));
  words += expected.length;
  const faithful = c.fixture.faithful === undefined ? undefined : lenientSplitWords(normalize(c.fixture.faithful));
  // Hypothesis words the faithful reference also charges. A run against
  // `expected` that touches none of them is right against what was typed.
  const wrongVsTyped = new Set<number>();
  if (faithful) {
    for (const span of wordMismatches(faithful, got)) {
      for (let k = span.hypStart; k < span.hypEnd; k++) wrongVsTyped.add(k);
      if (span.hypStart === span.hypEnd) wrongVsTyped.add(span.hypStart);
    }
  }
  for (const span of wordMismatches(expected, got)) {
    const ref = expected.slice(span.refStart, span.refEnd).join(" ");
    const hyp = got.slice(span.hypStart, span.hypEnd).join(" ");
    let touches = false;
    for (let k = span.hypStart; k <= span.hypEnd && !touches; k++) {
      if (k < span.hypEnd || span.hypStart === span.hypEnd) touches = wrongVsTyped.has(k);
    }
    const group: Group = faithful && !touches ? "typed" : engineError(ref, hyp);
    counts.set(group, counts.get(group)! + span.cost);
    charged += span.cost;
    const list = examples.get(group)!;
    if (list.length < perGroup) list.push(`${c.fixture.input.slice(0, 60)}\n      want ${ref || "(nothing)"}   got ${hyp || "(nothing)"}`);
  }
}

console.log(`engine=${engine}  dev, orthographic tier  words=${words}  charged=${charged} ` +
  `(${((100 * (words - charged)) / words).toFixed(1)}% right)\n`);
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

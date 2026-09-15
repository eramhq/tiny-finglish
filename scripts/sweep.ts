/**
 * Tuning sweeps over the rule baseline's scoring constants — on dev and the
 * fixtures, never on gold.
 *
 *   node scripts/sweep.ts --grid frequency=3,5,8 outOfTable=-4,-2,0
 *   node scripts/sweep.ts --grid mode=walk,channel
 *
 * Every combination in the grid is scored on `data/dev/dev.jsonl` (strict word
 * accuracy against `expected` and against `faithful`, plus the orthographic
 * tier) and on `data/fixtures/fixtures.jsonl`. The data artifacts are decoded
 * once; each configuration builds a fresh engine, so the word memo never
 * carries one configuration's answer into the next.
 *
 * The objective when choosing is the mean of dev-faithful and fixtures, read
 * off a flat region rather than a maximum — the same discipline the existing
 * `UNIT_COST` sweep documents in `src/baseline.ts`.
 */
import { SCORING, type ScoringParams } from "../src/baseline.ts";
import { lenientSplitWords, wordAccuracy } from "../src/metrics.ts";
import { normalize } from "../src/normalize.ts";
import { Transliterator } from "../src/index.ts";
import { loadFixtures, loadFrequency, loadLexicon, loadModel } from "./_load.ts";

const argv = process.argv.slice(2);
const gridAt = argv.indexOf("--grid");
const specs = gridAt >= 0 ? argv.slice(gridAt + 1).filter((a) => a.includes("=")) : [];
const useModel = argv.includes("--model");

const axes: Array<[keyof ScoringParams, Array<string | number>]> = specs.map((spec) => {
  const [key, values] = spec.split("=") as [keyof ScoringParams, string];
  if (!(key in SCORING)) throw new Error(`unknown scoring key ${key}`);
  return [key, values.split(",").map((v) => (Number.isNaN(Number(v)) ? v : Number(v)))];
});

function* combinations(i = 0, acc: Partial<ScoringParams> = {}): Generator<Partial<ScoringParams>> {
  if (i === axes.length) {
    yield acc;
    return;
  }
  const [key, values] = axes[i]!;
  for (const value of values) yield* combinations(i + 1, { ...acc, [key]: value });
}

const frequency = loadFrequency();
const lexicon = loadLexicon();
const model = useModel ? loadModel() : undefined;
const dev = loadFixtures("data/dev/dev.jsonl");
const fixtures = loadFixtures().filter((f) => f.expected !== null);

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}`;
console.log(`| ${axes.map(([k]) => k).join(" | ")} | dev strict | dev faithful | dev ortho-faithful | fixtures | objective |`);
console.log(`|${axes.map(() => "---|").join("")}---:|---:|---:|---:|---:|`);

for (const scoring of combinations()) {
  const engine = new Transliterator({
    ...(frequency ? { frequency } : {}),
    ...(lexicon ? { lexicon } : {}),
    ...(model ? { model, hybrid: true } : {}),
    scoring,
  });
  let strict = 0, faithful = 0, ortho = 0, devTotal = 0, faithfulTotal = 0;
  for (const row of dev) {
    const got = normalize(engine.transliterate(row.input).text);
    const s = wordAccuracy(normalize(row.expected!), got);
    strict += s.correct;
    devTotal += s.total;
    const f = wordAccuracy(normalize(row.faithful!), got);
    faithful += f.correct;
    faithfulTotal += f.total;
    ortho += wordAccuracy(normalize(row.faithful!), got, lenientSplitWords).correct;
  }
  let fx = 0, fxTotal = 0;
  for (const row of fixtures) {
    const w = wordAccuracy(normalize(row.expected!), normalize(engine.transliterate(row.input).text));
    fx += w.correct;
    fxTotal += w.total;
  }
  const objective = ((faithful / faithfulTotal) + (fx / fxTotal)) / 2;
  console.log(
    `| ${axes.map(([k]) => String(scoring[k])).join(" | ")} | ${pct(strict, devTotal)} | ${pct(faithful, faithfulTotal)} | ` +
    `${pct(ortho, faithfulTotal)} | ${pct(fx, fxTotal)} | ${(objective * 100).toFixed(2)} |`,
  );
}

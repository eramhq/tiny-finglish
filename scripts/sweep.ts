/**
 * Tuning sweeps over the rule baseline's scoring constants — on dev and the
 * fixtures, never on gold.
 *
 *   node scripts/sweep.ts --grid frequency=3,5,8 outOfTable=-4,-2,0
 *   node scripts/sweep.ts --grid mode=walk,channel
 *   node scripts/sweep.ts --engine model --weights training/runs/v5/weights.json   # a retrained model
 *   node scripts/sweep.ts --frequency /tmp/fa-frequency.bin --vowels /tmp/fa-vowels.bin   # a candidate table
 *
 * Every combination in the grid is scored on `data/dev/dev.jsonl` (strict word
 * accuracy against `expected` and against `faithful`, plus the orthographic
 * tier) and on `data/fixtures/fixtures.jsonl`. The data artifacts are decoded
 * once; each configuration builds a fresh engine, so the word memo never
 * carries one configuration's answer into the next.
 *
 * With `data/chat/chat-dev.jsonl` present it is scored too, against the
 * closest accepted spelling (`acceptedWordAccuracy`). Those messages are
 * AI-typed, so read its column for differences between settings, not as an
 * absolute.
 *
 * The objective when choosing is the mean of dev-faithful, fixtures and
 * chat-dev (dev-faithful and fixtures alone without chat-dev), read off a flat
 * region rather than a maximum — the same discipline the existing `UNIT_COST`
 * sweep documents in `src/baseline.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { SCORING, type ScoringParams } from "../src/baseline.ts";
import { acceptedWordAccuracy, orthographicWordAccuracy, wordAccuracy } from "../src/metrics.ts";
import { normalize } from "../src/normalize.ts";
import { Transliterator } from "../src/index.ts";
import { brotliDecompressSync } from "node:zlib";
import { decodeFrequencyTable } from "../src/frequency.ts";
import { decodeVowelTable } from "../src/vowels.ts";
import { loadFixtures, loadFrequency, loadLexicon, loadModel, loadVowels } from "./_load.ts";

const argv = process.argv.slice(2);
const gridAt = argv.indexOf("--grid");
const specs = gridAt >= 0 ? argv.slice(gridAt + 1).filter((a) => a.includes("=")) : [];
const engineAt = argv.indexOf("--engine");
const engineName = engineAt >= 0 ? argv[engineAt + 1]! : argv.includes("--model") ? "hybrid" : "rules";
const weightsAt = argv.indexOf("--weights");
const fittedAt = argv.indexOf("--fitted");
const fitted = fittedAt >= 0 ? JSON.parse(readFileSync(argv[fittedAt + 1]!, "utf8")) : undefined;
const useModel = engineName !== "rules";

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

const pathOf = (name: string) => (argv.indexOf(`--${name}`) >= 0 ? argv[argv.indexOf(`--${name}`) + 1]! : undefined);
const frequencyPath = pathOf("frequency");
const vowelsPath = pathOf("vowels");
const frequency = frequencyPath
  ? decodeFrequencyTable(brotliDecompressSync(readFileSync(frequencyPath)))
  : loadFrequency();
const lexicon = loadLexicon();
// Always loaded: `vowelAgreement=0` is the same engine as no table at all.
const vowels = vowelsPath ? decodeVowelTable(brotliDecompressSync(readFileSync(vowelsPath))) : loadVowels();
const model = !useModel
  ? undefined
  : weightsAt >= 0
    ? JSON.parse(readFileSync(argv[weightsAt + 1]!, "utf8"))
    : loadModel();
const dev = loadFixtures("data/dev/dev.jsonl");
const fixtures = loadFixtures().filter((f) => f.expected !== null);
const chatFile = "data/chat/chat-dev.jsonl";
const chat = existsSync(new URL(`../${chatFile}`, import.meta.url)) ? loadFixtures(chatFile) : [];

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}`;
const chatCols = chat.length ? " chat-dev (AI-typed) |" : "";
console.log(`| ${axes.map(([k]) => k).join(" | ")} | dev strict | dev faithful | dev ortho-faithful | fixtures |${chatCols} objective |`);
console.log(`|${axes.map(() => "---|").join("")}---:|---:|---:|---:|${chat.length ? "---:|" : ""}---:|`);

for (const scoring of combinations()) {
  const engine = new Transliterator({
    ...(frequency ? { frequency } : {}),
    ...(lexicon ? { lexicon } : {}),
    ...(vowels ? { vowels } : {}),
    ...(model ? { model, hybrid: engineName === "hybrid" } : {}),
    scoring: fitted ? { ...scoring, fitted } : scoring,
  });
  let strict = 0, faithful = 0, ortho = 0, orthoTotal = 0, devTotal = 0, faithfulTotal = 0;
  for (const row of dev) {
    const got = normalize(engine.transliterate(row.input).text);
    const s = wordAccuracy(normalize(row.expected!), got);
    strict += s.correct;
    devTotal += s.total;
    const f = wordAccuracy(normalize(row.faithful!), got);
    faithful += f.correct;
    faithfulTotal += f.total;
    const o = orthographicWordAccuracy(normalize(row.faithful!), got);
    ortho += o.correct;
    orthoTotal += o.total;
  }
  let fx = 0, fxTotal = 0;
  for (const row of fixtures) {
    const w = wordAccuracy(normalize(row.expected!), normalize(engine.transliterate(row.input).text));
    fx += w.correct;
    fxTotal += w.total;
  }
  let ch = 0, chTotal = 0;
  for (const row of chat) {
    const accepted = [row.expected!, ...row.alternatives].map((r) => normalize(r));
    const w = acceptedWordAccuracy(accepted, normalize(engine.transliterate(row.input).text));
    ch += w.correct;
    chTotal += w.total;
  }
  const parts = [faithful / faithfulTotal, fx / fxTotal, ...(chTotal ? [ch / chTotal] : [])];
  const objective = parts.reduce((a, b) => a + b, 0) / parts.length;
  console.log(
    `| ${axes.map(([k]) => String(scoring[k])).join(" | ")} | ${pct(strict, devTotal)} | ${pct(faithful, faithfulTotal)} | ` +
    `${pct(ortho, orthoTotal)} | ${pct(fx, fxTotal)} |${chTotal ? ` ${pct(ch, chTotal)} |` : ""} ${(objective * 100).toFixed(2)} |`,
  );
}

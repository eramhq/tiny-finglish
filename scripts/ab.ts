/**
 * A/B two engine configs on one dataset, and say whether the difference is real.
 *
 *   node scripts/ab.ts --dev --a "weights=training/runs/v7/weights.json" --b "weights=training/runs/v8-sentence/weights.json"
 *   node scripts/ab.ts --gold --a rules --b hybrid
 *   node scripts/ab.ts --chat --a model --b "model,bigram"
 *
 * A side is a comma- or space-separated list of: `rules | model | hybrid`
 * (default `model`), `weights=<repo-relative path>`, `vowels=<path>` (another
 * vowel table), `bigram`, `no-vowels`,
 * `no-frequency` — the `run-fixtures.ts` flag vocabulary. Datasets are the
 * `run-fixtures.ts` ones: `--dev`, `--gold`, `--chat`, `--chat-test`, fixtures
 * by default.
 *
 * Both sides score the same rows; the paired bootstrap in `scripts/_stats.ts`
 * resamples rows once per iteration for both, so only the difference the
 * engines make is left in the interval. "real" means the 95% CI excludes 0.
 * `--tier` picks the word-accuracy tier. The default is `orthographic`, the
 * headline, which forgives ZWNJ and compound spacing (`orthographicWordAccuracy`); `strict`
 * compares against `expected` exactly; `accepted` against the closest of
 * `expected` and the row's `alternatives` (how chat-dev is quoted).
 * `--quiet` drops the per-row listing.
 */
import { buildFixtureReport, type CaseResult } from "./_report.ts";
import { bootstrapCI, pairedBootstrap, verdict, type Counts } from "./_stats.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const file = flag("chat") ? "data/chat/chat-dev.jsonl"
  : flag("chat-test") ? "data/chat/chat-test.jsonl"
  : flag("dev") ? "data/dev/dev.jsonl"
  : flag("gold")
    ? (value("gold-set") === "authored" ? "data/gold/authored.jsonl" : "data/gold/gold.jsonl")
    : "data/fixtures/fixtures.jsonl";

const tier = value("tier") ?? "orthographic";
if (tier !== "strict" && tier !== "accepted" && tier !== "orthographic") {
  throw new Error(`--tier is strict, accepted or orthographic, not ${tier}`);
}
const score = (c: CaseResult): Counts => tier === "orthographic"
  ? { correct: c.tiers.orthographic, total: c.tiers.orthographicTotal }
  : { correct: tier === "accepted" ? c.tiers.accepted : c.wordsCorrect, total: c.wordsTotal };

interface Side {
  label: string;
  cases: CaseResult[];
}

function run(spec: string): Side {
  let engine = "model";
  let weights: string | undefined;
  let vowelsFile: string | undefined;
  const extras = new Set<string>();
  for (const token of spec.split(/[\s,]+/).filter(Boolean)) {
    if (token === "rules" || token === "model" || token === "hybrid") engine = token;
    else if (token.startsWith("weights=")) weights = token.slice("weights=".length);
    else if (token.startsWith("vowels=")) vowelsFile = token.slice("vowels=".length);
    else if (token === "bigram" || token === "no-vowels" || token === "no-frequency") extras.add(token);
    else throw new Error(`unknown engine option ${JSON.stringify(token)} in ${JSON.stringify(spec)}`);
  }
  if (engine === "rules" && weights) throw new Error(`"rules" ignores weights: ${JSON.stringify(spec)}`);
  const report = buildFixtureReport({
    useModel: engine !== "rules",
    useHybrid: engine === "hybrid",
    useBigram: extras.has("bigram"),
    useVowels: !extras.has("no-vowels"),
    useFrequency: !extras.has("no-frequency"),
    weights,
    vowelsFile,
    file,
  });
  return { label: `${report.engine}${weights ? ` [${weights}]` : ""}${vowelsFile ? ` [vowels ${vowelsFile}]` : ""}${extras.size ? ` +${[...extras].join(",")}` : ""}`, cases: report.cases };
}

const specA = value("a");
const specB = value("b");
if (!specA || !specB) {
  console.error('usage: node scripts/ab.ts [--dev|--gold|--chat|--chat-test] --a "<engine>" --b "<engine>"');
  process.exit(2);
}

const a = run(specA);
const b = run(specB);

// Pair by fixture id. Both sides load the same file, so this is a check more
// than a join; it fails loudly if ids are not unique.
const byId = new Map(b.cases.map((c) => [c.fixture.id, c]));
if (byId.size !== b.cases.length) throw new Error(`${file}: fixture ids are not unique`);
const rowsA: Counts[] = [];
const rowsB: Counts[] = [];
const changed: Array<{ id: string; input: string; a: CaseResult; b: CaseResult; ra: Counts; rb: Counts }> = [];
let bBetter = 0, aBetter = 0, tied = 0;
for (const ca of a.cases) {
  const cb = byId.get(ca.fixture.id);
  if (!cb) throw new Error(`${ca.fixture.id} missing from side b`);
  if (ca.wordsTotal === 0 && cb.wordsTotal === 0) continue;
  const ra = score(ca), rb = score(cb);
  rowsA.push(ra);
  rowsB.push(rb);
  const d = rb.correct - ra.correct;
  if (d > 0) bBetter++;
  else if (d < 0) aBetter++;
  else tied++;
  if (d !== 0 || ca.result.text !== cb.result.text) {
    changed.push({ id: ca.fixture.id, input: ca.fixture.input, a: ca, b: cb, ra, rb });
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}`;
const ciA = bootstrapCI(rowsA);
const ciB = bootstrapCI(rowsB);
const paired = pairedBootstrap(rowsA, rowsB);
const sum = (rows: Counts[]) => rows.reduce((n, r) => n + r.correct, 0);
const words = rowsA.reduce((n, r) => n + r.total, 0);

const lines: string[] = [];
lines.push(`dataset ${file}  rows=${rowsA.length}  words=${words}  tier=${tier}`);
lines.push("");
if (!flag("quiet")) {
  lines.push(`rows whose output differs (${changed.length}), ${tier} words correct/total  a → b`);
  for (const c of changed) {
    const d = c.rb.correct - c.ra.correct;
    const mark = d > 0 ? "b+" : d < 0 ? "a+" : "= ";
    lines.push(`  ${mark} ${c.id.padEnd(22)} ${`${c.ra.correct}/${c.ra.total}`.padStart(6)} → ${`${c.rb.correct}/${c.rb.total}`.padEnd(6)} ${JSON.stringify(c.input)}`);
    lines.push(`       a ${c.a.result.text}`);
    lines.push(`       b ${c.b.result.text}`);
  }
  lines.push("");
}
lines.push(`a  ${a.label}`);
lines.push(`   ${tier} ${pct(ciA.value)}  (95% CI ${pct(ciA.lo)}–${pct(ciA.hi)})  ${sum(rowsA)}/${words}`);
lines.push(`b  ${b.label}`);
lines.push(`   ${tier} ${pct(ciB.value)}  (95% CI ${pct(ciB.lo)}–${pct(ciB.hi)})  ${sum(rowsB)}/${words}`);
lines.push("");
lines.push(`b − a  ${pts(paired.delta)} pts  (95% CI ${pts(paired.lo)} to ${pts(paired.hi)})  ` +
  `P(b better) ${paired.pBetter.toFixed(3)}  → ${verdict(paired)}`);
lines.push(`rows   b better ${bBetter}  a better ${aBetter}  tied ${tied}`);
console.log(lines.join("\n"));

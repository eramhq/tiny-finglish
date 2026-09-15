/**
 * The judged-acceptable tier: LLM judges decide which charged word runs are
 * legitimate renderings, and the verdicts are cached in the repository.
 *
 *   node scripts/judge.ts --export DIR [--dev|--gold] [--engines rules,model] [--shards N] [--every K]
 *   node scripts/judge.ts --import DIR
 *   node scripts/judge.ts --calibrate FILE        # judges against hand labels
 *
 * `--export` runs each engine over the set, takes every run of words the strict
 * metric charged (`wordMismatches` in `src/metrics.ts`), drops the ones already
 * in `data/results/judgments.jsonl`, and writes the rest as shards for the
 * judges. The prompt is `data/provenance/prompts/judge-span.md`.
 *
 * `--import` reads the judges' files back — `claude-*.jsonl` and `luna-*.jsonl`,
 * one `{key, verdict, category}` per line — and merges them into the cache.
 * **A run is accepted only when both families accept it**; one family's opinion
 * is recorded but refunds nothing. Multilingual LLM judges alone agree with
 * humans at around κ≈0.3, which is why this tier needs two of them and why it
 * is never the headline.
 *
 * `scripts/_report.ts` prints `unjudged runs: N` instead of guessing, so a tier
 * computed over a partly judged set says so.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { normalize } from "../src/normalize.ts";
import { buildTransliterator, loadFixtures } from "./_load.ts";
import { JUDGMENTS, loadJudgments, mismatchTriples, type Judgment, type Triple } from "./_judgments.ts";

const root = new URL("..", import.meta.url);
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

/** The two model families. A verdict from anything else is refused. */
const FAMILIES = ["claude", "luna"] as const;
const VERDICTS = new Set(["accept", "reject"]);

function readJsonl<T>(path: string | URL): T[] {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
}

function exportShards(dir: string): void {
  const file = flag("gold") ? "data/gold/gold.jsonl" : flag("dev") ? "data/dev/dev.jsonl" : "data/fixtures/fixtures.jsonl";
  const engines = (value("engines") ?? "rules,model").split(",");
  const shards = Number(value("shards") ?? 4);
  const judged = loadJudgments();
  // `--every K` judges a fixed sample, every Kth row, when judging the whole
  // set would cost more than the tier is worth. The report then says which.
  const every = Number(value("every") ?? 1);
  const rows = loadFixtures(file).filter((row, index) => row.expected !== null && index % every === 0);

  const pending = new Map<string, Triple>();
  for (const engine of engines) {
    const transliterator = buildTransliterator({
      model: engine !== "rules",
      hybrid: engine === "hybrid",
    });
    for (const row of rows) {
      const got = normalize(transliterator.transliterate(row.input).text);
      for (const triple of mismatchTriples(row.id, row.input, normalize(row.expected!), got)) {
        if (!judged.has(triple.key)) pending.set(triple.key, triple);
      }
    }
  }

  mkdirSync(dir, { recursive: true });
  const all = [...pending.values()].sort((a, b) => a.id.localeCompare(b.id) || a.key.localeCompare(b.key));
  for (let k = 0; k < shards; k++) {
    // Contiguous by row, so a judge reads one sentence's runs together.
    const size = Math.ceil(all.length / shards);
    const shard = all.slice(k * size, (k + 1) * size).map(({ cost: _cost, ...rest }) => rest);
    writeFileSync(`${dir}/shard-${k}.jsonl`, shard.map((t) => JSON.stringify(t)).join("\n") + (shard.length ? "\n" : ""));
  }
  console.log(`${file}: ${all.length} unjudged runs over engines ${engines.join(", ")} -> ${dir} (${shards} shards)`);
}

function importVerdicts(dir: string): void {
  const shards = new Map<string, Triple>();
  const verdicts = new Map<string, Record<string, { verdict: string; category?: string }>>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const family = FAMILIES.find((f) => name.startsWith(`${f}-`));
    if (name.startsWith("shard-")) {
      for (const triple of readJsonl<Triple>(`${dir}/${name}`)) shards.set(triple.key, triple);
      continue;
    }
    if (!family) continue;
    for (const line of readJsonl<{ key: string; verdict: string; category?: string }>(`${dir}/${name}`)) {
      if (!VERDICTS.has(line.verdict)) throw new Error(`${name}: bad verdict ${JSON.stringify(line.verdict)} for ${line.key}`);
      const byFamily = verdicts.get(line.key) ?? {};
      byFamily[family] = { verdict: line.verdict, ...(line.category ? { category: line.category } : {}) };
      verdicts.set(line.key, byFamily);
    }
  }

  const cache = loadJudgments();
  let added = 0;
  let accepted = 0;
  let disagreed = 0;
  for (const [key, byFamily] of verdicts) {
    const triple = shards.get(key);
    if (!triple) throw new Error(`verdict for unknown key ${key}; shards missing from ${dir}?`);
    if (!FAMILIES.every((f) => byFamily[f])) continue;
    const both = FAMILIES.map((f) => byFamily[f]!.verdict);
    const judgment: Judgment = {
      key, id: triple.id, refSpan: triple.refSpan, hypSpan: triple.hypSpan,
      verdicts: Object.fromEntries(FAMILIES.map((f) => [f, byFamily[f]!.verdict])),
      accepted: both.every((v) => v === "accept"),
    };
    const category = FAMILIES.map((f) => byFamily[f]!.category).find(Boolean);
    if (judgment.accepted && category) judgment.category = category;
    if (new Set(both).size > 1) disagreed++;
    if (judgment.accepted) accepted++;
    if (!cache.has(key)) added++;
    cache.set(key, judgment);
  }

  const sorted = [...cache.values()].sort((a, b) => a.id.localeCompare(b.id) || a.key.localeCompare(b.key));
  writeFileSync(new URL(JUDGMENTS, root), sorted.map((j) => JSON.stringify(j)).join("\n") + "\n");
  console.log(`merged ${verdicts.size} keys: ${added} new, ${accepted} accepted by both, ${disagreed} disagreements`);
  console.log(`${JUDGMENTS}: ${sorted.length} judgments`);
}

/** Agreement of each family, and of the both-accept rule, with hand labels. */
function calibrate(file: string): void {
  if (!existsSync(file)) throw new Error(`${file} not found`);
  const hand = readJsonl<{ key: string; verdict: string }>(file);
  const cache = loadJudgments();
  const rows: Array<[string, (j: Judgment) => string]> = [
    ...FAMILIES.map((f) => [f, (j: Judgment) => j.verdicts[f]!] as [string, (j: Judgment) => string]),
    ["both-accept rule", (j: Judgment) => (j.accepted ? "accept" : "reject")],
  ];
  console.log(`| judge | n | agreement | κ | false accepts | false rejects |`);
  console.log(`|---|---:|---:|---:|---:|---:|`);
  for (const [name, pick] of rows) {
    let n = 0, agree = 0, falseAccept = 0, falseReject = 0, handAccept = 0, judgeAccept = 0;
    for (const label of hand) {
      const judgment = cache.get(label.key);
      if (!judgment) continue;
      const said = pick(judgment);
      n++;
      if (said === label.verdict) agree++;
      else if (said === "accept") falseAccept++;
      else falseReject++;
      if (label.verdict === "accept") handAccept++;
      if (said === "accept") judgeAccept++;
    }
    const po = agree / n;
    const pe = (handAccept / n) * (judgeAccept / n) + (1 - handAccept / n) * (1 - judgeAccept / n);
    const kappa = pe === 1 ? 1 : (po - pe) / (1 - pe);
    console.log(`| ${name} | ${n} | ${(po * 100).toFixed(1)}% | ${kappa.toFixed(2)} | ${falseAccept} | ${falseReject} |`);
  }
}

const exportDir = value("export");
const importDir = value("import");
const calibration = value("calibrate");
if (exportDir) exportShards(exportDir);
else if (importDir) importVerdicts(importDir);
else if (calibration) calibrate(calibration);
else {
  console.error("usage: node scripts/judge.ts --export DIR [--dev|--gold] [--engines rules,model] [--shards N] | --import DIR | --calibrate FILE");
  process.exit(2);
}

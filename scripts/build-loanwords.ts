/**
 * Build the loanword table: `data/lexicon/loanwords.tsv` -> `src/loanwords.ts`.
 *
 *   node scripts/build-loanwords.ts --merge   # the LLM shards -> loanwords.tsv, with both verdicts
 *   node scripts/build-loanwords.ts           # loanwords.tsv -> src/loanwords.ts, printing every drop
 *
 * The TSV holds every entry the writers produced, with the Claude and luna
 * verdicts (`loanwords-review.md`). Only entries both families accept are
 * built, and then a mechanical guard drops the ones that would hijack
 * Finglish:
 *
 *   * `homograph` — the spelling is in `FINGLISH_HOMOGRAPHS` (`src/english.ts`);
 *   * `finglish` — the rules engine, reading the spelling as Finglish, already
 *     writes a *common* table word (frequency >= `COMMON`) that is not the
 *     entry. That is what keeps `bad`, `mast` and `name` Finglish: a texter who
 *     types a word the engine reads as an everyday Persian word most likely
 *     means that word.
 *
 * The output is a generated module, like `src/channel-fitted.ts`, so the
 * rules-only tier gets the table without a fetch. Provenance, review tallies
 * and every drop go to `data/provenance/loanwords.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { RuleBaseline } from "../src/baseline.ts";
import { FINGLISH_HOMOGRAPHS } from "../src/english.ts";
import { normalize } from "../src/normalize.ts";
import { loadFrequency, loadLexicon } from "./_load.ts";

const root = new URL("..", import.meta.url);
const at = (path: string) => new URL(path, root);
const TSV = "data/lexicon/loanwords.tsv";
const RUNS = "training/runs/llm/loanwords";
const PROMPTS = ["loanwords-write.md", "loanwords-review.md"];

/**
 * The frequency above which the engine's own reading of a spelling counts as
 * an everyday word. Chosen by reading the drop list at every threshold, since
 * no tuning set has these words: 0.25 is a round value under `love` (لو,
 * 0.29) and `bus` (بوس, 0.29; both reviewers rejected it too), which must stay
 * Finglish. It also costs real loanwords whose
 * letters happen to spell a common word — `file` (فیل), `delete` (دلت),
 * `battery` (بطری) — which is the direction to err in: a missed loanword is
 * left as the engine reads it, a hijacked Persian word is always wrong.
 */
const COMMON = 0.25;

/** The brand section is capped by hand: converting a brand is the exception. */
const MAX_BRANDS = 15;

interface Entry {
  en: string;
  fa: string;
  category: string;
  claude: string;
  luna: string;
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const readJsonl = (path: string) =>
  readFileSync(at(path), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, string>);

if (process.argv.includes("--merge")) merge();
else build();

function merge(): void {
  const input = readJsonl(`${RUNS}/review-in.jsonl`);
  const verdicts = (file: string) => {
    const rows = readJsonl(`${RUNS}/${file}`);
    if (rows.length !== input.length) throw new Error(`${file}: ${rows.length} verdicts for ${input.length} entries`);
    rows.forEach((row, i) => {
      if (row.en !== input[i]!.en) throw new Error(`${file}:${i + 1}: ${row.en} is not ${input[i]!.en}`);
      if (row.verdict !== "accept" && row.verdict !== "reject") throw new Error(`${file}:${i + 1}: verdict ${row.verdict}`);
    });
    return rows;
  };
  // The first review pass told both families to reject brands, so the brand
  // section was reviewed again with the amended prompt, and those verdicts
  // replace the first pass's for the brand rows.
  const brandRows = input.filter((row) => row.category === "brand");
  const rereview = (first: string, brands: string) => {
    const rows = verdicts(first);
    const again = readJsonl(`${RUNS}/${brands}`);
    if (again.length !== brandRows.length) throw new Error(`${brands}: ${again.length} verdicts for ${brandRows.length} brands`);
    again.forEach((row, k) => {
      if (row.en !== brandRows[k]!.en) throw new Error(`${brands}:${k + 1}: ${row.en} is not ${brandRows[k]!.en}`);
      rows[input.indexOf(brandRows[k]!)] = row;
    });
    return rows;
  };
  const claude = rereview("claude-review.jsonl", "claude-brand-review.jsonl");
  const luna = rereview("luna-review.jsonl", "luna-brand-review.jsonl");
  const lines = ["en\tfa\tcategory\tclaude\tluna\tclaude_reason\tluna_reason"];
  input.forEach((row, i) => {
    lines.push([row.en, row.fa, row.category, claude[i]!.verdict, luna[i]!.verdict,
      clean(claude[i]!.reason), clean(luna[i]!.reason)].join("\t"));
  });
  writeFileSync(at(TSV), `${lines.join("\n")}\n`);
  console.log(`wrote ${TSV}: ${input.length} entries`);
}

function clean(text: string | undefined): string {
  return (text ?? "").replace(/[\t\n]+/g, " ").trim();
}

function build(): void {
  const [header, ...rows] = readFileSync(at(TSV), "utf8").split("\n").filter(Boolean);
  const columns = header!.split("\t");
  const entries: Entry[] = rows.map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""])) as unknown as Entry;
  });

  const tally = { both: 0, claudeOnly: 0, lunaOnly: 0, neither: 0 };
  const accepted: Entry[] = [];
  for (const e of entries) {
    const c = e.claude === "accept";
    const l = e.luna === "accept";
    if (c && l) {
      tally.both++;
      accepted.push(e);
    } else if (c) tally.claudeOnly++;
    else if (l) tally.lunaOnly++;
    else tally.neither++;
  }

  const frequency = loadFrequency();
  const lexicon = loadLexicon();
  if (!frequency) throw new Error("the guard needs data/lexicon/fa-frequency.bin");
  const rules = new RuleBaseline({ frequency, ...(lexicon ? { lexicon } : {}) });

  const drops: Array<{ en: string; fa: string; reason: string; finglish?: string; frequency?: number }> = [];
  const kept: Entry[] = [];
  for (const e of accepted) {
    const fa = normalize(e.fa);
    if (FINGLISH_HOMOGRAPHS.has(e.en)) {
      drops.push({ en: e.en, fa, reason: "homograph" });
      continue;
    }
    const top = rules.transliterate(e.en, { results: 1 })[0];
    const reading = top ? normalize(top.output) : "";
    const score = frequency.get(reading) ?? 0;
    if (reading && reading !== fa && score >= COMMON) {
      drops.push({ en: e.en, fa, reason: "finglish", finglish: reading, frequency: Math.round(score * 1000) / 1000 });
      continue;
    }
    kept.push({ ...e, fa });
  }

  const brands = kept.filter((e) => e.category === "brand");
  if (brands.length > MAX_BRANDS) throw new Error(`${brands.length} brands; the cap is ${MAX_BRANDS}`);

  for (const d of drops) {
    console.log(`drop ${d.reason.padEnd(9)} ${d.en.padEnd(14)} ${d.fa}${d.finglish ? `  (reads as ${d.finglish}, ${d.frequency})` : ""}`);
  }
  console.log(`\n${entries.length} entries; review ${JSON.stringify(tally)}; guard dropped ${drops.length}; ` +
    `built ${kept.length} (${brands.length} brands)`);

  const sorted = [...kept].sort((a, b) => (a.en < b.en ? -1 : 1));
  const body = sorted.map((e) => `${e.en} ${e.fa}`).join("\n");
  writeFileSync(at("src/loanwords.ts"),
    `/**\n * GENERATED by scripts/build-loanwords.ts — do not edit.\n *\n` +
    ` * Source: ${TSV}, ${kept.length} of ${entries.length} entries: accepted by both review families,\n` +
    ` * then the Finglish guard. One \`english persian\` pair per line; parsed by \`loan.ts\`.\n */\n` +
    `export const LOANWORDS = ${JSON.stringify(body)};\n`);

  const provenancePath = "data/provenance/loanwords.json";
  const previous = existsSync(at(provenancePath)) ? JSON.parse(readFileSync(at(provenancePath), "utf8")) : {};
  const provenance = {
    $comment: "GENERATED by scripts/build-loanwords.ts, except `workers`, `shards` and `date`, which are kept from the previous file.",
    date: previous.date ?? new Date().toISOString().slice(0, 10),
    license: "CC0-1.0: the table is this project's own LLM output, reviewed",
    workers: previous.workers ?? {},
    file: TSV,
    sha256: sha256(readFileSync(at(TSV))),
    entries: entries.length,
    categories: Object.fromEntries([...new Set(entries.map((e) => e.category))].map((c) =>
      [c, entries.filter((e) => e.category === c).length])),
    review: tally,
    guard: { common: COMMON, dropped: drops.length, drops },
    built: { module: "src/loanwords.ts", entries: kept.length, brands: brands.map((e) => e.en) },
    prompts: Object.fromEntries(PROMPTS.map((p) => [p, sha256(readFileSync(at(`data/provenance/prompts/${p}`)))])),
    shards: previous.shards ?? {},
  };
  writeFileSync(at(provenancePath), `${JSON.stringify(provenance, null, 2)}\n`);
}

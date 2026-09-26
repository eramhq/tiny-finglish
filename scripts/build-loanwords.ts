/**
 * Build the loanword and abbreviation tables -> `src/loanwords.ts`.
 *
 *   node scripts/build-loanwords.ts --merge [--abbreviations]   # LLM shards -> the TSV, with both verdicts
 *   node scripts/build-loanwords.ts                             # both TSVs -> src/loanwords.ts, printing every drop
 *
 * `data/lexicon/loanwords.tsv` holds English spellings of loanwords (`backup`);
 * `data/lexicon/abbreviations.tsv` holds texting abbreviations (`mrc`). They
 * are built the same way; `loan.ts` reads Persian endings on the first and
 * matches the second exactly.
 *
 * The TSV holds every entry the writers produced, with the Claude and luna
 * verdicts (`loanwords-review.md`). Only entries both families accept are
 * built, and then a mechanical guard drops the ones that would hijack
 * Finglish:
 *
 *   * `homograph` — the spelling is in `FINGLISH_HOMOGRAPHS` (`src/english.ts`);
 *   * `finglish` — the rules engine, reading the spelling as Finglish, already
 *     writes a *common* table word (frequency >= `COMMON`) that is not the
 *     entry, **and** typists have not been seen to avoid that spelling for it.
 *     That is what keeps `bad`, `mast` and `name` Finglish: a texter who types
 *     a word the engine reads as an everyday Persian word may well mean it.
 *
 * "Seen to avoid" is read off the LLM-typed corpus
 * (`data/distill/llm-finglish.jsonl.br`, word-aligned): the colliding word is
 * cleared when it was typed at least `EVIDENCE` times and never as the
 * entry's spelling. Typists write سری as `seri` and `sari` 92 times and never
 * as `sorry`, so `sorry` is سوری; they write فک as `fake` 10 times in 42, so
 * `fake` stays Finglish. A colliding word typed fewer times than that is not
 * evidence either way and the entry is dropped: فیل is typed twice, so `file`
 * is still read as Finglish.
 *
 * The output is a generated module, like `src/channel-fitted.ts`, so the
 * rules-only tier gets the table without a fetch. Provenance, review tallies
 * and every drop go to `data/provenance/loanwords.json`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { RuleBaseline } from "../src/baseline.ts";
import { FINGLISH_HOMOGRAPHS } from "../src/english.ts";
import { normalize } from "../src/normalize.ts";
import { loadFrequency, loadLexicon } from "./_load.ts";

const root = new URL("..", import.meta.url);
const at = (path: string) => new URL(path, root);
interface Table {
  name: "loanwords" | "abbreviations";
  tsv: string;
  runs: string;
  prompts: string[];
  /** The export in `src/loanwords.ts`. */
  constant: string;
}

const TABLES: Record<Table["name"], Table> = {
  loanwords: {
    name: "loanwords",
    tsv: "data/lexicon/loanwords.tsv",
    runs: "training/runs/llm/loanwords",
    prompts: ["loanwords-write.md", "loanwords-review.md"],
    constant: "LOANWORDS",
  },
  abbreviations: {
    name: "abbreviations",
    tsv: "data/lexicon/abbreviations.tsv",
    runs: "training/runs/llm/abbreviations",
    prompts: ["abbreviations-write.md", "abbreviations-review.md"],
    constant: "ABBREVIATIONS",
  },
};

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

/**
 * Typings of the colliding word needed before "never typed this way" counts.
 * A round number, not a tuned one: the drops it decides are listed in the
 * provenance with their counts.
 */
const EVIDENCE = 10;

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

if (process.argv.includes("--merge")) {
  if (process.argv.includes("--abbreviations")) mergeAbbreviations();
  else merge();
} else {
  const built: Array<{ table: Table; kept: Entry[] }> = [];
  for (const table of [TABLES.loanwords, TABLES.abbreviations]) {
    if (!existsSync(at(table.tsv))) continue;
    // An abbreviation the loanword table already spells (`ok`) is dropped:
    // `loan.ts` would match the abbreviation first and shadow the loanword.
    const taken = new Set(built.flatMap(({ kept }) => kept.map((e) => e.en)));
    built.push({ table, kept: build(table, taken) });
  }
  writeFileSync(at("src/loanwords.ts"),
    `/**\n * GENERATED by scripts/build-loanwords.ts — do not edit.\n *\n` +
    built.map(({ table, kept }) => ` * ${table.constant}: ${table.tsv}, ${kept.length} entries.\n`).join("") +
    ` *\n * Accepted by both review families, then the Finglish guard. One \`typed persian\` pair\n` +
    ` * per line; parsed by \`loan.ts\`.\n */\n` +
    built.map(({ table, kept }) => `export const ${table.constant} = ${JSON.stringify(
      [...kept].sort((a, b) => (a.en < b.en ? -1 : 1)).map((e) => `${e.en} ${e.fa}`).join("\n"))};\n`).join("") +
    (built.some(({ table }) => table.name === "abbreviations") ? "" : `export const ABBREVIATIONS = "";\n`));
}

function verdictsFor(runs: string, input: Array<Record<string, string>>, file: string) {
  const rows = readJsonl(`${runs}/${file}`);
  if (rows.length !== input.length) throw new Error(`${file}: ${rows.length} verdicts for ${input.length} entries`);
  rows.forEach((row, i) => {
    if (row.en !== input[i]!.en) throw new Error(`${file}:${i + 1}: ${row.en} is not ${input[i]!.en}`);
    if (row.verdict !== "accept" && row.verdict !== "reject") throw new Error(`${file}:${i + 1}: verdict ${row.verdict}`);
  });
  return rows;
}

function writeTsv(table: Table, input: Array<Record<string, string>>, claude: Array<Record<string, string>>,
  luna: Array<Record<string, string>>, category: (row: Record<string, string>) => string): void {
  const lines = ["en\tfa\tcategory\tclaude\tluna\tclaude_reason\tluna_reason"];
  input.forEach((row, i) => {
    lines.push([row.en, row.fa, category(row), claude[i]!.verdict, luna[i]!.verdict,
      clean(claude[i]!.reason), clean(luna[i]!.reason)].join("\t"));
  });
  writeFileSync(at(table.tsv), `${lines.join("\n")}\n`);
  console.log(`wrote ${table.tsv}: ${input.length} entries`);
}

function mergeAbbreviations(): void {
  const { runs } = TABLES.abbreviations;
  const input = readJsonl(`${runs}/review-in.jsonl`);
  writeTsv(TABLES.abbreviations, input, verdictsFor(runs, input, "claude-review.jsonl"),
    verdictsFor(runs, input, "luna-review.jsonl"), (row) => row.kind ?? "");
}

function merge(): void {
  const RUNS = TABLES.loanwords.runs;
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
  writeTsv(TABLES.loanwords, input, claude, luna, (row) => row.category ?? "");
}

/** Persian word -> how the LLM typists typed it, with counts. */
function corpusTypings(): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const text = brotliDecompressSync(readFileSync(at("data/distill/llm-finglish.jsonl.br"))).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as { fa: string[]; finglish: string[] };
    row.fa.forEach((word, i) => {
      const key = normalize(word);
      const typed = (row.finglish[i] ?? "").toLowerCase();
      const counts = out.get(key) ?? new Map<string, number>();
      counts.set(typed, (counts.get(typed) ?? 0) + 1);
      out.set(key, counts);
    });
  }
  return out;
}

function clean(text: string | undefined): string {
  return (text ?? "").replace(/[\t\n]+/g, " ").trim();
}

function build(table: Table, taken: ReadonlySet<string> = new Set()): Entry[] {
  const TSV = table.tsv;
  console.log(`== ${table.name}`);
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

  const typings = corpusTypings();
  type Collision = { en: string; fa: string; finglish: string; frequency: number; typed: number; asEntry: number };
  const drops: Array<{ en: string; fa: string; reason: string } & Partial<Collision>> = [];
  const cleared: Collision[] = [];
  const kept: Entry[] = [];
  for (const e of accepted) {
    const fa = normalize(e.fa);
    if (taken.has(e.en)) {
      drops.push({ en: e.en, fa, reason: "loanword" });
      continue;
    }
    // `idk` -> نمیدونم is a translation, not a transliteration: an English
    // abbreviation stays English, like any other English word. Only Persian
    // skeletons (`mrc`, `nmdnm`) are built.
    if (table.name === "abbreviations" && e.category === "english") {
      drops.push({ en: e.en, fa, reason: "translation" });
      continue;
    }
    if (FINGLISH_HOMOGRAPHS.has(e.en)) {
      drops.push({ en: e.en, fa, reason: "homograph" });
      continue;
    }
    const top = rules.transliterate(e.en, { results: 1 })[0];
    const reading = top ? normalize(top.output) : "";
    const score = frequency.get(reading) ?? 0;
    if (reading && reading !== fa && score >= COMMON) {
      const seen = typings.get(reading);
      const typed = seen ? [...seen.values()].reduce((a, b) => a + b, 0) : 0;
      const asEntry = seen?.get(e.en) ?? 0;
      const collision = { en: e.en, fa, finglish: reading, frequency: Math.round(score * 1000) / 1000, typed, asEntry };
      if (typed < EVIDENCE || asEntry > 0) {
        drops.push({ ...collision, reason: "finglish" });
        continue;
      }
      cleared.push(collision);
    }
    kept.push({ ...e, fa });
  }

  const brands = kept.filter((e) => e.category === "brand");
  if (brands.length > MAX_BRANDS) throw new Error(`${brands.length} brands; the cap is ${MAX_BRANDS}`);

  for (const d of drops) {
    console.log(`drop ${d.reason.padEnd(9)} ${d.en.padEnd(14)} ${d.fa}` +
      (d.finglish ? `  (reads as ${d.finglish}, ${d.frequency}; typed ${d.typed}x, ${d.asEntry}x as ${d.en})` : ""));
  }
  for (const c of cleared) {
    console.log(`keep cleared   ${c.en.padEnd(14)} ${c.fa}  (reads as ${c.finglish}, ${c.frequency}; typed ${c.typed}x, never as ${c.en})`);
  }
  console.log(`\n${entries.length} entries; review ${JSON.stringify(tally)}; guard dropped ${drops.length}; ` +
    `built ${kept.length} (${brands.length} brands)`);

  const provenancePath = `data/provenance/${table.name}.json`;
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
    guard: { common: COMMON, evidence: EVIDENCE, dropped: drops.length, drops, cleared },
    built: { module: "src/loanwords.ts", entries: kept.length, brands: brands.map((e) => e.en) },
    prompts: Object.fromEntries(table.prompts.map((p) => [p, sha256(readFileSync(at(`data/provenance/prompts/${p}`)))])),
    shards: previous.shards ?? {},
  };
  writeFileSync(at(provenancePath), `${JSON.stringify(provenance, null, 2)}\n`);
  return kept;
}

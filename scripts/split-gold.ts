/**
 * Quarantine the gold rows whose two sides are not the same sentence.
 *
 *     node scripts/split-gold.ts            # report what would move
 *     node scripts/split-gold.ts --write    # move it, and update the provenance
 *
 * Stage two of the gold pipeline. `build_gold.py` drops 826 rows whose Persian
 * and Finglish word counts disagree by more than one; that filter cannot see a
 * row where the counts happen to match and the *content* does not:
 *
 *     input      "4 you have to call"
 *     expected   "چهارم، توزیع مجدد ثروت"
 *
 * Five words against four, so the word-delta filter keeps it. It scores 0% and
 * always will, for every engine, at every beam width. 71 of the 1,906 rows
 * (3.7%) are like this.
 *
 * **They are moved, not deleted.** They are evidence about the source dataset —
 * the residue of a collection process that the published provenance should
 * describe rather than quietly discard. `data/gold/gold-misaligned.jsonl` keeps
 * them readable, and `data/provenance/gold.json` records the count and the rule.
 *
 * The rule is engine-dependent, and deliberately so: "no transliterator could
 * produce this" is not a property of a string pair that can be read off in
 * isolation. It is pinned to the strongest configuration this repository ships
 * — rules + frequency + lexicon — and to the same fold the headline metric
 * uses, so the threshold means what the headline means. Both are recorded.
 *
 * Idempotent: it reads both files back, recombines them, and re-runs the rule,
 * so running it twice is the same as running it once, and a later engine change
 * that rescues a row will return it to the set.
 *
 * **A second rule, from an LLM alignment audit.** The CER rule is engine-bound,
 * and it misses misaligned rows whose sides happen to share letters. So every
 * row was also shown — input and reference only, never an engine's output — to
 * two model families (a Claude subagent and Codex GPT-5.6 luna), each labelling
 * it aligned, partial or misaligned. `data/gold/audit.jsonl` records both
 * verdicts per row, keyed to the row's content hash so a changed row loses its
 * verdict rather than inheriting one. A row moves only when **both** families
 * say misaligned, or when they disagree and adjudication on reading the row
 * says so; the file records which. Every quarantined row carries a `reason`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { characterErrorRate, splitWords } from "../src/metrics.ts";
import { normalize } from "../src/normalize.ts";
import { buildTransliterator, type Fixture } from "./_load.ts";

const root = new URL("..", import.meta.url);
const GOLD = "data/gold/gold.jsonl";
const MISALIGNED = "data/gold/gold-misaligned.jsonl";
const PROVENANCE = "data/provenance/gold.json";
const AUDIT = "data/gold/audit.jsonl";
const FAITHFUL = "data/gold/faithful.jsonl";

interface FaithfulRow {
  id: string;
  rowSha: string;
  faithful: string;
  by: "both" | "adjudicated";
}

interface AuditRow {
  id: string;
  rowSha: string;
  verdicts: Record<string, string>;
  /** Final call. `misaligned` only on both families, or on adjudication. */
  final: "aligned" | "partial" | "misaligned";
  by: "both" | "adjudicated";
}

/** Same identity as `row_sha` in `training/tiny_finglish_training/build_dev.py`. */
function rowSha(row: Fixture): string {
  return createHash("sha256").update(`${row.input}\t${row.expected}`).digest("hex").slice(0, 16);
}

/**
 * Above this, the reference and a competent transliteration of the input share
 * almost no characters. Set where the population is: 0.88 admits 76 rows and
 * 0.92 only 52, and inspection of the band between them finds real pairs a
 * better engine could reach. 0.9 is the conservative edge of the cliff.
 */
const CER_THRESHOLD = 0.9;
const ENGINE = "rules + frequency + lexicon";

const WRITE = process.argv.includes("--write");

function readRows(relative: string): Fixture[] {
  const path = new URL(relative, root);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Fixture);
}

function writeRows(relative: string, rows: readonly Fixture[]): void {
  writeFileSync(
    new URL(relative, root),
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
  );
}

/** CER in the headline metric's own terms: ZWNJ and punctuation folded away. */
function foldedCer(reference: string, hypothesis: string): number {
  return characterErrorRate(splitWords(reference).join(" "), splitWords(hypothesis).join(" "));
}

type Quarantined = Fixture & { reason: "cer" | "audit"; cer: number };

// Strip the fields this script adds, so a rescued row returns to gold clean.
const all = [...readRows(GOLD), ...readRows(MISALIGNED)]
  .map(({ cer: _cer, reason: _reason, faithful: _faithful, ...row }: Fixture & { cer?: number; reason?: string }) =>
    row as Fixture)
  .sort((a, b) => a.id.localeCompare(b.id));
const transliterator = buildTransliterator({ model: false });

const audit = new Map<string, AuditRow>();
if (existsSync(new URL(AUDIT, root))) {
  for (const row of readRows(AUDIT) as unknown as AuditRow[]) audit.set(row.id, row);
}
const faithfulRows = new Map<string, FaithfulRow>();
if (existsSync(new URL(FAITHFUL, root))) {
  for (const row of readRows(FAITHFUL) as unknown as FaithfulRow[]) faithfulRows.set(row.id, row);
}

const kept: Fixture[] = [];
const misaligned: Quarantined[] = [];
let staleAudits = 0;
for (const row of all) {
  if (row.expected === null) {
    kept.push(row);
    continue;
  }
  const cer = Math.round(
    foldedCer(normalize(row.expected), normalize(transliterator.transliterate(row.input).text)) * 1000,
  ) / 1000;
  const verdict = audit.get(row.id);
  if (verdict && verdict.rowSha !== rowSha(row)) staleAudits++;
  if (cer > CER_THRESHOLD) misaligned.push({ ...row, reason: "cer", cer });
  else if (verdict?.rowSha === rowSha(row) && verdict.final === "misaligned") misaligned.push({ ...row, reason: "audit", cer });
  else kept.push(row);
}
const byReason = (reason: string) => misaligned.filter((r) => r.reason === reason).length;
const auditMoved = misaligned.filter((r) => r.reason === "audit");
const adjudicated = auditMoved.filter((r) => audit.get(r.id)!.by === "adjudicated").length;

console.log(`gold rows       ${all.length}`);
console.log(`kept            ${kept.length}`);
console.log(`misaligned      ${misaligned.length}`);
console.log(`  cer           ${byReason("cer")}  (CER > ${CER_THRESHOLD} under ${ENGINE})`);
console.log(`  audit         ${byReason("audit")}  (${auditMoved.length - adjudicated} both judges, ${adjudicated} adjudicated; ${audit.size} audited, ${staleAudits} stale)`);
if (staleAudits) {
  console.error(`${staleAudits} audit rows no longer match their gold row; re-run the audit for them`);
  process.exit(1);
}

// The second reference, attached by content hash like the audit: a kept row
// whose text changed, or that has none, stops the run rather than scoring
// against a reference written for another sentence.
if (faithfulRows.size) {
  let staleFaithful = 0;
  for (const [i, row] of kept.entries()) {
    const f = faithfulRows.get(row.id);
    if (row.expected === null) continue;
    if (!f || f.rowSha !== rowSha(row)) {
      staleFaithful++;
      if (staleFaithful <= 5) console.error(`  no current faithful reference for ${row.id}`);
      continue;
    }
    kept[i] = { ...row, faithful: f.faithful };
  }
  const changed = kept.filter((r) => r.faithful !== undefined && r.faithful !== r.expected).length;
  console.log(`faithful        ${kept.length - staleFaithful} attached, ${changed} differ from expected; ${staleFaithful} stale or missing`);
  if (staleFaithful) {
    console.error(`${staleFaithful} gold rows have no current faithful reference; re-run gold_faithful for them`);
    process.exit(1);
  }
}
for (const row of misaligned.slice(0, 5)) {
  console.log(`  ${row.id}  ${JSON.stringify(row.input)} -> ${JSON.stringify(row.expected)}`);
}
if (misaligned.length > 5) console.log(`  ... and ${misaligned.length - 5} more`);

if (!WRITE) {
  console.log("\n(dry run; pass --write to apply)");
  process.exit(0);
}

writeRows(GOLD, kept);
writeRows(MISALIGNED, misaligned);

const sha = (relative: string) =>
  createHash("sha256").update(readFileSync(new URL(relative, root))).digest("hex");

const provenance = JSON.parse(readFileSync(new URL(PROVENANCE, root), "utf8")) as Record<string, unknown>;
const dropped = provenance["dropped"] as Record<string, number>;
writeFileSync(
  new URL(PROVENANCE, root),
  `${JSON.stringify(
    {
      ...provenance,
      $comment:
        "GENERATED in two stages: training/tiny_finglish_training/build_gold.py, then " +
        "scripts/split-gold.ts --write. Re-running the first alone restores the quarantined rows.",
      kept: kept.length,
      dropped: { ...dropped, contentMismatch: misaligned.length },
      contentMismatch: {
        file: MISALIGNED,
        rows: misaligned.length,
        byReason: { cer: byReason("cer"), audit: byReason("audit") },
        rule: `characterErrorRate > ${CER_THRESHOLD}; otherwise the alignment audit's final verdict is misaligned`,
        measuredAgainst: ENGINE,
        fold:
          "ZWNJ and punctuation folded to spaces first — splitWords() from src/metrics.ts, " +
          "so the threshold is stated in the same terms as the headline word accuracy",
        why:
          "The word-delta filter above cannot see a row whose two sides have matching word " +
          "counts and different content. These rows score 0% for any transliterator. They " +
          "are moved rather than deleted: they are evidence about the source dataset.",
        sha256: sha(MISALIGNED),
      },
      ...(audit.size
        ? {
          alignmentAudit: {
            ...(provenance["alignmentAudit"] as Record<string, unknown> | undefined),
            file: AUDIT,
            rowsAudited: audit.size,
            quarantined: auditMoved.length,
            quarantinedByBothJudges: auditMoved.length - adjudicated,
            quarantinedByAdjudication: adjudicated,
            sha256: sha(AUDIT),
          },
        }
        : {}),
      ...(faithfulRows.size
        ? {
          faithfulPass: {
            // The record of the labour (workers, prompt, shards, spot check)
            // is written by hand at merge time; this script owns the counts.
            ...(provenance["faithfulPass"] as Record<string, unknown> | undefined),
            file: FAITHFUL,
            rows: kept.filter((r) => r.faithful !== undefined).length,
            byBoth: [...faithfulRows.values()].filter((r) => r.by === "both").length,
            byAdjudication: [...faithfulRows.values()].filter((r) => r.by === "adjudicated").length,
            differFromExpected: kept.filter((r) => r.faithful !== undefined && r.faithful !== r.expected).length,
            sha256: sha(FAITHFUL),
          },
        }
        : {}),
      sha256: sha(GOLD),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote ${GOLD} (${kept.length}) and ${MISALIGNED} (${misaligned.length})`);
console.log(`updated ${PROVENANCE}`);

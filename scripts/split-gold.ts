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

const all = [...readRows(GOLD), ...readRows(MISALIGNED)].sort((a, b) => a.id.localeCompare(b.id));
const transliterator = buildTransliterator({ model: false });

const kept: Fixture[] = [];
const misaligned: Array<Fixture & { cer: number }> = [];
for (const row of all) {
  if (row.expected === null) {
    kept.push(row);
    continue;
  }
  const cer = foldedCer(normalize(row.expected), normalize(transliterator.transliterate(row.input).text));
  if (cer > CER_THRESHOLD) misaligned.push({ ...row, cer: Math.round(cer * 1000) / 1000 });
  else kept.push(row);
}

console.log(`gold rows       ${all.length}`);
console.log(`kept            ${kept.length}`);
console.log(`misaligned      ${misaligned.length}  (CER > ${CER_THRESHOLD} under ${ENGINE})`);
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
        rule: `characterErrorRate > ${CER_THRESHOLD}`,
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
      sha256: sha(GOLD),
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote ${GOLD} (${kept.length}) and ${MISALIGNED} (${misaligned.length})`);
console.log(`updated ${PROVENANCE}`);

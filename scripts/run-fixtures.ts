/**
 * M1 exit condition: one command converts the fixture corpus and produces
 * inspectable explanations.
 *
 *   node scripts/run-fixtures.ts                 # summary table
 *   node scripts/run-fixtures.ts --verbose       # every failure, with reasons
 *   node scripts/run-fixtures.ts --rules         # rule baseline only
 *   node scripts/run-fixtures.ts --bigram        # + the sentence-context pass (opt-in)
 *   node scripts/run-fixtures.ts --no-vowels     # ablate the vowel-agreement term
 *   node scripts/run-fixtures.ts --hybrid        # both engines, arbitrated per word
 *   node scripts/run-fixtures.ts --gold          # untouched gold: real human Finglish
 *   node scripts/run-fixtures.ts --gold --gold-set authored   # the old 71 authored pairs
 *   node scripts/run-fixtures.ts --dev           # real human Finglish disjoint from gold — the tuning surface
 *   node scripts/run-fixtures.ts --id ordinary-001
 */
import { buildFixtureReport, formatReport } from "./_report.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const report = buildFixtureReport({
  useModel: !flag("rules"),
  useFrequency: !flag("no-frequency"),
  useBigram: flag("bigram"),
  useVowels: !flag("no-vowels"),
  useHybrid: flag("hybrid"),
  file: flag("dev")
    ? "data/dev/dev.jsonl"
    : flag("gold")
      ? (value("gold-set") === "authored" ? "data/gold/authored.jsonl" : "data/gold/gold.jsonl")
      : "data/fixtures/fixtures.jsonl",
  onlyId: value("id"),
});

console.log(formatReport(report, { verbose: flag("verbose") || Boolean(value("id")) }));
if (flag("strict") && report.totals.top1 < report.totals.count) process.exit(1);

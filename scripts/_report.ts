/**
 * Fixture evaluation shared by the CLI and the test suite.
 *
 * Reports the metrics the plan asks for — top-1 word accuracy, top-3 recall,
 * CER, exact match, ZWNJ accuracy, copy-span preservation — rather than a
 * single number, because a single number hides exactly the regressions that
 * matter here. A change that gains two points on ordinary words while breaking
 * URL preservation is a net loss, and only the per-category view shows it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { buildTransliterator, DEFAULT_WEIGHTS, loadFixtures, type Fixture } from "./_load.ts";
import { bootstrapCI } from "./_stats.ts";
import { normalize } from "../src/normalize.ts";
import { PUNCTUATION_FOLDS } from "../src/unicode.ts";
import { acceptedWordAccuracy, characterErrorRate, orthographicWordAccuracy, wordAccuracy } from "../src/metrics.ts";
import { loadJudgments, mismatchTriples } from "./_judgments.ts";
import type { TransliterationResult } from "../src/types.ts";

export { characterErrorRate, wordAccuracy };

const ZWNJ = "‌";

export interface CaseResult {
  fixture: Fixture;
  result: TransliterationResult;
  top1: boolean;
  top3: boolean;
  cer: number;
  actionOk: boolean;
  /** Converted words matching the reference, and how many were compared. */
  wordsCorrect: number;
  wordsTotal: number;
  tiers: Tiers;
}

/**
 * Word accuracy at several strictnesses. `orthographic` is the headline: no
 * evaluation reference writes ZWNJ, so `strict` charges a correct می‌کنم, and
 * only the orthographic tier compares an engine that writes the half-space
 * fairly with one that cannot. `strict` is reported beside it; `judged` says
 * how much an LLM judge pair accepts as a legitimate rendering. See
 * `src/metrics.ts` and `scripts/judge.ts`.
 */
export interface Tiers {
  strict: number;
  orthographic: number;
  /**
   * Reference words after the orthographic join, which merges `می کنم` into
   * one word: the orthographic tier's own denominator. Dividing its count by
   * the strict `total` instead scored a perfect `می کنم` row at 50%.
   */
  orthographicTotal: number;
  /** Strict against the closest of `expected` and the row's `alternatives`. */
  accepted: number;
  /** Strict plus the refunded cost of runs both judges accepted. */
  judged: number;
  /** Charged runs with no verdict yet. Reported, never guessed. */
  unjudged: number;
  /** Against `faithful` — the reference edited to what was typed — when the row has one. */
  faithfulStrict: number;
  faithfulOrthographic: number;
  faithfulTotal: number;
  faithfulOrthographicTotal: number;
  total: number;
}

function emptyTiers(): Tiers {
  return { strict: 0, orthographic: 0, orthographicTotal: 0, accepted: 0, judged: 0, unjudged: 0,
    faithfulStrict: 0, faithfulOrthographic: 0, faithfulTotal: 0, faithfulOrthographicTotal: 0, total: 0 };
}

function addTiers(into: Tiers, from: Tiers): void {
  for (const key of Object.keys(into) as Array<keyof Tiers>) into[key] += from[key];
}

export interface Bucket {
  count: number;
  top1: number;
  top3: number;
  cer: number;
  wordsCorrect: number;
  wordsTotal: number;
}

export interface Report {
  cases: CaseResult[];
  byCategory: Map<string, Bucket>;
  totals: {
    count: number;
    top1: number;
    top3: number;
    cer: number;
    wordsCorrect: number;
    wordsTotal: number;
    zwnjCorrect: number;
    zwnjTotal: number;
    copyPreserved: number;
    copyTotal: number;
    punctLocalized: number;
    punctTotal: number;
    tiers: Tiers;
    /** Rows carrying a `faithful` reference. */
    faithfulRows: number;
  };
  engine: string;
  modelHash: string | null;
  datasetHash: string;
}

export function buildFixtureReport(options: {
  useModel?: boolean;
  useFrequency?: boolean;
  useBigram?: boolean;
  useHybrid?: boolean;
  useVowels?: boolean;
  /** Repo-relative weights file; the shipped one by default. */
  weights?: string | undefined;
  /** Vowel table file; the shipped one by default. */
  vowelsFile?: string | undefined;
  file?: string;
  onlyId?: string | undefined;
}): Report {
  const transliterator = buildTransliterator({
    model: options.useModel !== false,
    frequency: options.useFrequency !== false,
    bigram: options.useBigram === true,
    hybrid: options.useHybrid === true,
    vowels: options.useVowels !== false,
    ...(options.weights ? { weights: options.weights } : {}),
    ...(options.vowelsFile ? { vowelsFile: options.vowelsFile } : {}),
  });
  let fixtures = loadFixtures(options.file);
  if (options.onlyId) fixtures = fixtures.filter((f) => f.id === options.onlyId);

  const cases: CaseResult[] = [];
  const byCategory = new Map<string, Bucket>();
  const totals = {
    count: 0, top1: 0, top3: 0, cer: 0, wordsCorrect: 0, wordsTotal: 0,
    zwnjCorrect: 0, zwnjTotal: 0, copyPreserved: 0, copyTotal: 0,
    punctLocalized: 0, punctTotal: 0, tiers: emptyTiers(), faithfulRows: 0,
  };
  const judgments = loadJudgments();

  for (const fixture of fixtures) {
    const result = transliterator.transliterate(fixture.input);
    const category = fixture.category ?? "gold";

    // Copy-span preservation is checked for every fixture, not just the
    // protected ones: a regression that mangles a URL inside a sentence is the
    // failure mode that actually loses users.
    for (const span of result.spans) {
      if (span.action === "copy") {
        totals.copyTotal++;
        if (span.output === span.input) totals.copyPreserved++;
      }
      // Punctuation localization, measured here because `wordAccuracy` no
      // longer can: it folds marks to separators on both sides, so a `?` left
      // un-localized in a Persian run is now invisible to the headline number.
      // Scored against the *engine's own* output rather than the reference,
      // because the gold's punctuation is un-localized ASCII throughout and
      // scoring against it would penalize doing the right thing.
      for (const ch of span.output) {
        if (!LOCALIZABLE.has(ch)) continue;
        totals.punctTotal++;
        if (span.action === "copy" ? ch === LOCALIZABLE.get(ch) : ch !== LOCALIZABLE.get(ch)) {
          totals.punctLocalized++;
        }
      }
    }

    if (fixture.expected === null) {
      cases.push({ fixture, result, top1: true, top3: true, cer: 0, actionOk: true, wordsCorrect: 0, wordsTotal: 0, tiers: emptyTiers() });
      continue;
    }

    const expected = normalize(fixture.expected);
    const got = normalize(result.text);
    const accepted = [expected, ...fixture.alternatives.map((a) => normalize(a))];
    const top1 = accepted.includes(got);
    const top3 = top1 || result.alternatives.some((a) => accepted.includes(normalize(a)));
    const cer = characterErrorRate(expected, got);

    const actionOk = fixture.expectAction
      ? result.spans.every((s) => s.action !== "convert" || fixture.expectAction !== "copy")
      : true;

    if (expected.includes(ZWNJ) || got.includes(ZWNJ)) {
      totals.zwnjTotal++;
      if (zwnjPositions(expected) === zwnjPositions(got)) totals.zwnjCorrect++;
    }

    const words = wordAccuracy(expected, got);
    const tiers = scoreTiers(fixture, accepted, got, words, judgments);
    addTiers(totals.tiers, tiers);
    if (fixture.faithful !== undefined) totals.faithfulRows++;

    const bucket = byCategory.get(category) ?? { count: 0, top1: 0, top3: 0, cer: 0, wordsCorrect: 0, wordsTotal: 0 };
    bucket.count++;
    bucket.top1 += top1 ? 1 : 0;
    bucket.top3 += top3 ? 1 : 0;
    bucket.cer += cer;
    bucket.wordsCorrect += words.correct;
    bucket.wordsTotal += words.total;
    byCategory.set(category, bucket);

    totals.count++;
    totals.top1 += top1 ? 1 : 0;
    totals.top3 += top3 ? 1 : 0;
    totals.cer += cer;
    totals.wordsCorrect += words.correct;
    totals.wordsTotal += words.total;
    cases.push({ fixture, result, top1, top3, cer, actionOk, wordsCorrect: words.correct, wordsTotal: words.total, tiers });
  }

  return {
    cases, byCategory, totals,
    engine: `${options.useHybrid ? "hybrid" : transliterator.hasModel ? "model" : "rules"}` +
      `${transliterator.hasContext ? " + context" : ""}`,
    modelHash: transliterator.hasModel ? hashFile(options.weights ?? DEFAULT_WEIGHTS) : null,
    datasetHash: hashFile(options.file ?? "data/fixtures/fixtures.jsonl") ?? "",
  };
}

function scoreTiers(
  fixture: Fixture,
  accepted: readonly string[],
  got: string,
  strict: { correct: number; total: number },
  judgments: ReturnType<typeof loadJudgments>,
): Tiers {
  const expected = accepted[0]!;
  const tiers = emptyTiers();
  tiers.total = strict.total;
  tiers.strict = strict.correct;
  const orthographic = orthographicWordAccuracy(expected, got);
  tiers.orthographic = orthographic.correct;
  tiers.orthographicTotal = orthographic.total;
  tiers.accepted = acceptedWordAccuracy(accepted, got).correct;

  // Refund what both judges accepted. Errors are capped at the reference
  // length exactly as `wordAccuracy` caps them, so refunds are taken off the
  // uncapped distance first.
  let distance = 0;
  let refunded = 0;
  for (const triple of mismatchTriples(fixture.id, fixture.input, expected, got)) {
    distance += triple.cost;
    const judgment = judgments.get(triple.key);
    if (!judgment) tiers.unjudged++;
    else if (judgment.accepted) refunded += triple.cost;
  }
  tiers.judged = strict.total - Math.min(distance - refunded, strict.total);

  if (fixture.faithful !== undefined) {
    const faithful = normalize(fixture.faithful);
    tiers.faithfulTotal = wordAccuracy(faithful, got).total;
    tiers.faithfulStrict = wordAccuracy(faithful, got).correct;
    const faithfulOrthographic = orthographicWordAccuracy(faithful, got);
    tiers.faithfulOrthographic = faithfulOrthographic.correct;
    tiers.faithfulOrthographicTotal = faithfulOrthographic.total;
  }
  return tiers;
}

function hashFile(relative: string): string | null {
  const path = new URL(`../${relative}`, import.meta.url);
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

/**
 * ASCII marks and their Persian forms, in both directions.
 *
 * Maps each member of a localizable pair to the *ASCII* member, so
 * `ch === LOCALIZABLE.get(ch)` asks "is this still the Latin form?".
 */
const LOCALIZABLE = new Map<string, string>(
  PUNCTUATION_FOLDS.flatMap(([latin, persian]) => [
    [latin, latin] as const,
    [persian, latin] as const,
  ]),
);

function zwnjPositions(text: string): string {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === ZWNJ) out.push(i);
  return out.join(",");
}

export function formatReport(report: Report, options: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");

  lines.push(`engine=${report.engine}  model=${report.modelHash ?? "none"}  dataset=${report.datasetHash}`);
  lines.push("");
  lines.push("| category | n | word acc | sentence | top-3 | CER |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const [category, b] of [...report.byCategory].sort()) {
    lines.push(
      `| ${category} | ${b.count} | ${pct(b.wordsCorrect, b.wordsTotal)} | ${pct(b.top1, b.count)} | ` +
      `${pct(b.top3, b.count)} | ${(b.cer / b.count).toFixed(3)} |`,
    );
  }
  const t = report.totals;
  lines.push(
    `| **all** | ${t.count} | **${pct(t.wordsCorrect, t.wordsTotal)}** | ${pct(t.top1, t.count)} | ` +
    `${pct(t.top3, t.count)} | ${(t.cer / t.count).toFixed(3)} |`,
  );
  lines.push("");
  lines.push(`copy-span preservation  ${pct(t.copyPreserved, t.copyTotal)}  (${t.copyPreserved}/${t.copyTotal})`);
  lines.push(`ZWNJ placement          ${pct(t.zwnjCorrect, t.zwnjTotal)}  (${t.zwnjCorrect}/${t.zwnjTotal})`);
  lines.push(`punctuation localized   ${pct(t.punctLocalized, t.punctTotal)}  (${t.punctLocalized}/${t.punctTotal})`);
  const w = t.tiers;
  lines.push("");
  lines.push(`word accuracy tiers     vs expected${t.faithfulRows ? "    vs faithful" : ""}`);
  const faithfulCol = (n: number, d = w.faithfulTotal) => (t.faithfulRows ? `    ${pct(n, d).padStart(11)}` : "");
  // Rows, not words, are resampled: see `scripts/_stats.ts`.
  const one = (x: number) => (x * 100).toFixed(1);
  const ciLine = (rows: Array<{ correct: number; total: number }>) => {
    const ci = bootstrapCI(rows);
    return `    95% CI              ${`${one(ci.lo)}–${one(ci.hi)}`.padStart(11)}    (${t.count} rows resampled)`;
  };
  lines.push(`  orthographic (headline) ${pct(w.orthographic, w.orthographicTotal).padStart(9)}` +
    faithfulCol(w.faithfulOrthographic, w.faithfulOrthographicTotal));
  if (w.orthographicTotal) {
    lines.push(ciLine(report.cases.map((c) => ({ correct: c.tiers.orthographic, total: c.tiers.orthographicTotal }))));
  }
  lines.push(`  strict                ${pct(w.strict, w.total).padStart(11)}${faithfulCol(w.faithfulStrict)}`);
  if (w.total) lines.push(ciLine(report.cases.map((c) => ({ correct: c.wordsCorrect, total: c.wordsTotal }))));
  if (w.accepted !== w.strict) {
    lines.push(`  accepted spellings    ${pct(w.accepted, w.total).padStart(11)}`);
  }
  lines.push(`  judged-acceptable     ${pct(w.judged, w.total).padStart(11)}    unjudged runs: ${w.unjudged}`);

  if (options.verbose) {
    lines.push("", "--- failures ---");
    for (const c of report.cases) {
      if (c.top1 || c.fixture.expected === null) continue;
      lines.push("");
      lines.push(`${c.fixture.id}  ${JSON.stringify(c.fixture.input)}`);
      lines.push(`  expected  ${JSON.stringify(c.fixture.expected)}`);
      lines.push(`  got       ${JSON.stringify(c.result.text)}  (confidence ${c.result.confidence})`);
      if (c.result.alternatives.length) {
        lines.push(`  alts      ${c.result.alternatives.map((a) => JSON.stringify(a)).join(", ")}`);
      }
      for (const span of c.result.spans) {
        if (span.action !== "convert" || !span.candidates) continue;
        const why = span.candidates
          .map((x) => `${x.output}=${x.probability.toFixed(2)} [${x.reason}]`)
          .join("  ");
        lines.push(`    ${JSON.stringify(span.input)} -> ${why}`);
      }
      if (c.fixture.notes) lines.push(`  note      ${c.fixture.notes}`);
    }
  }
  return lines.join("\n");
}

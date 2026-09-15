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
import { buildTransliterator, loadFixtures, type Fixture } from "./_load.ts";
import { normalize } from "../src/normalize.ts";
import type { TransliterationResult } from "../src/types.ts";

const ZWNJ = "‌";

export interface CaseResult {
  fixture: Fixture;
  result: TransliterationResult;
  top1: boolean;
  top3: boolean;
  cer: number;
  actionOk: boolean;
}

export interface Report {
  cases: CaseResult[];
  byCategory: Map<string, { count: number; top1: number; top3: number; cer: number }>;
  totals: {
    count: number;
    top1: number;
    top3: number;
    cer: number;
    zwnjCorrect: number;
    zwnjTotal: number;
    copyPreserved: number;
    copyTotal: number;
  };
  engine: string;
  modelHash: string | null;
  datasetHash: string;
}

export function buildFixtureReport(options: {
  useModel?: boolean;
  file?: string;
  onlyId?: string | undefined;
}): Report {
  const transliterator = buildTransliterator({ model: options.useModel !== false });
  let fixtures = loadFixtures(options.file);
  if (options.onlyId) fixtures = fixtures.filter((f) => f.id === options.onlyId);

  const cases: CaseResult[] = [];
  const byCategory = new Map<string, { count: number; top1: number; top3: number; cer: number }>();
  const totals = {
    count: 0, top1: 0, top3: 0, cer: 0,
    zwnjCorrect: 0, zwnjTotal: 0, copyPreserved: 0, copyTotal: 0,
  };

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
    }

    if (fixture.expected === null) {
      cases.push({ fixture, result, top1: true, top3: true, cer: 0, actionOk: true });
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

    const bucket = byCategory.get(category) ?? { count: 0, top1: 0, top3: 0, cer: 0 };
    bucket.count++;
    bucket.top1 += top1 ? 1 : 0;
    bucket.top3 += top3 ? 1 : 0;
    bucket.cer += cer;
    byCategory.set(category, bucket);

    totals.count++;
    totals.top1 += top1 ? 1 : 0;
    totals.top3 += top3 ? 1 : 0;
    totals.cer += cer;
    cases.push({ fixture, result, top1, top3, cer, actionOk });
  }

  return {
    cases, byCategory, totals,
    engine: transliterator.hasModel ? "model" : "rules",
    modelHash: hashFile("data/fixtures/weights.json"),
    datasetHash: hashFile(options.file ?? "data/fixtures/fixtures.jsonl") ?? "",
  };
}

function hashFile(relative: string): string | null {
  const path = new URL(`../${relative}`, import.meta.url);
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12);
}

/** Levenshtein distance normalized by reference length. */
export function characterErrorRate(reference: string, hypothesis: string): number {
  if (reference === hypothesis) return 0;
  if (!reference.length) return hypothesis.length ? 1 : 0;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[hypothesis.length]! / reference.length;
}

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
  lines.push("| category | n | top-1 | top-3 | CER |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const [category, b] of [...report.byCategory].sort()) {
    lines.push(
      `| ${category} | ${b.count} | ${pct(b.top1, b.count)} | ${pct(b.top3, b.count)} | ${(b.cer / b.count).toFixed(3)} |`,
    );
  }
  const t = report.totals;
  lines.push(`| **all** | ${t.count} | **${pct(t.top1, t.count)}** | ${pct(t.top3, t.count)} | ${(t.cer / t.count).toFixed(3)} |`);
  lines.push("");
  lines.push(`copy-span preservation  ${pct(t.copyPreserved, t.copyTotal)}  (${t.copyPreserved}/${t.copyTotal})`);
  lines.push(`ZWNJ placement          ${pct(t.zwnjCorrect, t.zwnjTotal)}  (${t.zwnjCorrect}/${t.zwnjTotal})`);

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

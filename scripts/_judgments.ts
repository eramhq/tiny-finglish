/**
 * The judged-acceptable tier's shared plumbing: which word runs were charged,
 * how a judgment is keyed, and the committed cache of verdicts.
 *
 * A judgment is about a *string pair in a sentence*, not about an engine, so the
 * key is (row id, reference run, hypothesis run). Two engines that make the same
 * mistake on the same row share one verdict, and a judgment never goes stale
 * unless the row itself changes id.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { splitWords, wordMismatches } from "../src/metrics.ts";

const root = new URL("..", import.meta.url);
export const JUDGMENTS = "data/results/judgments.jsonl";

export interface Triple {
  key: string;
  id: string;
  input: string;
  reference: string;
  hypothesis: string;
  refSpan: string;
  hypSpan: string;
  cost: number;
}

export interface Judgment {
  key: string;
  id: string;
  refSpan: string;
  hypSpan: string;
  verdicts: Record<string, string>;
  accepted: boolean;
  category?: string;
}

export function judgmentKey(id: string, refSpan: string, hypSpan: string): string {
  return createHash("sha256").update(`${id}\t${refSpan}\t${hypSpan}`).digest("hex").slice(0, 16);
}

/** The runs the strict metric charged on one row, with their judgment keys. */
export function mismatchTriples(id: string, input: string, reference: string, hypothesis: string): Triple[] {
  const ref = splitWords(reference);
  const hyp = splitWords(hypothesis);
  return wordMismatches(ref, hyp).map((span) => {
    const refSpan = ref.slice(span.refStart, span.refEnd).join(" ");
    const hypSpan = hyp.slice(span.hypStart, span.hypEnd).join(" ");
    return {
      key: judgmentKey(id, refSpan, hypSpan),
      id, input, reference, hypothesis, refSpan, hypSpan, cost: span.cost,
    };
  });
}

export function loadJudgments(): Map<string, Judgment> {
  const path = new URL(JUDGMENTS, root);
  const out = new Map<string, Judgment>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const judgment = JSON.parse(line) as Judgment;
    out.set(judgment.key, judgment);
  }
  return out;
}

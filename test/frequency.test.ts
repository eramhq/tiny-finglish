/**
 * The frequency table. Small surface, but it carries the largest single
 * accuracy gain in the project, so the decode path is pinned.
 */
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeFrequencyTable, frequencyScore } from "../src/frequency.ts";
import { encodeFrontCoded } from "../src/frontcode.ts";

function artifact(words: string[], ranks: number[]): Uint8Array {
  const head = encodeFrontCoded(words);
  const out = new Uint8Array(head.length + ranks.length);
  out.set(head);
  // encodeFrontCoded sorts, so the rank bytes must follow the sorted order.
  out.set(Uint8Array.from(ranks), head.length);
  return out;
}

describe("decodeFrequencyTable", () => {
  it("pairs each word with its rank byte, normalized to [0,1]", () => {
    const words = ["الف", "ب", "ج"];
    const table = decodeFrequencyTable(artifact(words, [255, 128, 0]));
    expect(table.size).toBe(3);
    expect(table.get("الف")).toBeCloseTo(1, 6);
    expect(table.get("ب")).toBeCloseTo(128 / 255, 6);
    expect(table.get("ج")).toBe(0);
  });

  it("rejects a truncated artifact rather than returning silent garbage", () => {
    const words = ["الف", "ب", "ج"];
    expect(() => decodeFrequencyTable(artifact(words, [1, 2]))).toThrow(/truncated/);
  });

  it("handles an empty table", () => {
    expect(decodeFrequencyTable(artifact([], [])).size).toBe(0);
  });

  it("scores an unknown word as 0, not as a penalty", () => {
    // The table covers 25k types; Persian morphology generates far more, so
    // absence usually means "inflected form we did not count". Penalizing it
    // would systematically punish correct inflections.
    const table = decodeFrequencyTable(artifact(["الف"], [255]));
    expect(frequencyScore(table, "الف")).toBeCloseTo(1, 6);
    expect(frequencyScore(table, "چیزی")).toBe(0);
    expect(frequencyScore(undefined, "الف")).toBe(0);
  });

  it("decodes the committed artifact: the top 25k plus the chat supplement", () => {
    const path = new URL("../data/lexicon/fa-frequency.bin", import.meta.url);
    if (!existsSync(path)) return;
    const table = decodeFrequencyTable(brotliDecompressSync(readFileSync(path)));
    const provenance = JSON.parse(readFileSync(new URL("../data/provenance/frequency.json", import.meta.url), "utf8"));
    expect(table.size).toBe(25000 + (provenance.supplement?.words ?? 0));
    // Every supplement word enters at the one swept score.
    for (const word of Object.keys(provenance.supplement?.counts ?? {})) {
      expect(table.get(word)).toBeCloseTo(Math.round(255 * provenance.supplement.score) / 255, 6);
    }
    for (const score of table.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    // Common function words must outrank rare content words, or the table is
    // ordered wrongly and every ranking decision built on it is inverted.
    expect(table.get("را")!).toBeGreaterThan(table.get("کتاب") ?? 0);
    expect(table.get("که")!).toBeGreaterThan(table.get("کتاب") ?? 0);
  });
});

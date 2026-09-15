/**
 * The lexicon codec. A silent corruption here would surface as a slow accuracy
 * regression rather than a crash, so the round-trip is asserted on the real
 * committed artifact, not just on toy input.
 */
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeFrontCoded, encodeFrontCoded } from "../src/frontcode.ts";

describe("frontcode", () => {
  it("round-trips an ordinary sorted list", () => {
    const words = ["آب", "آبان", "آباد", "کتاب", "کتابخانه", "کتابها"].sort();
    expect(decodeFrontCoded(encodeFrontCoded(words))).toEqual(words);
  });

  it("sorts its input, so callers need not", () => {
    expect(decodeFrontCoded(encodeFrontCoded(["ب", "الف", "ج"]))).toEqual(["الف", "ب", "ج"]);
  });

  it("handles the degenerate cases", () => {
    expect(decodeFrontCoded(encodeFrontCoded([]))).toEqual([]);
    expect(decodeFrontCoded(encodeFrontCoded(["a"]))).toEqual(["a"]);
    // Identical neighbours share the entire prefix, so the suffix is empty.
    expect(decodeFrontCoded(encodeFrontCoded(["aa", "aa"]))).toEqual(["aa", "aa"]);
  });

  it("caps the shared prefix at 255 so the length byte cannot overflow", () => {
    const long = "ا".repeat(300);
    const words = [long, `${long}ب`];
    expect(decodeFrontCoded(encodeFrontCoded(words))).toEqual(words);
  });

  it("refuses an alphabet that would collide with the terminator", () => {
    const tooMany = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    expect(() => encodeFrontCoded(tooMany)).toThrow(/alphabet/);
  });

  it("round-trips the committed 100k-stem lexicon", () => {
    const path = new URL("../data/lexicon/fa-stems.bin", import.meta.url);
    if (!existsSync(path)) return;
    const words = decodeFrontCoded(brotliDecompressSync(readFileSync(path)));
    expect(words.length).toBeGreaterThan(90_000);
    expect(decodeFrontCoded(encodeFrontCoded(words))).toEqual(words);
    // Sorted and deduplicated, which the snap tier relies on.
    expect(new Set(words).size).toBe(words.length);
  });
});

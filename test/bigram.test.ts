/**
 * The bigram table.
 *
 * The decoder is the only thing standing between a 73 KiB binary and silently
 * wrong sentence context: a misread varint shifts every later head by one and
 * produces a table that is entirely well-formed and entirely wrong. So the
 * round trip is pinned against a hand-built artifact, and the committed one is
 * decoded and spot-checked.
 */
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bigramScore, decodeBigramTable, MAX_PMI } from "../src/bigram.ts";
import { encodeFrontCoded } from "../src/frontcode.ts";

/** Mirror of `varint()` in training/tiny_finglish_training/build_bigram.py. */
function varint(value: number): number[] {
  const out: number[] = [];
  for (;;) {
    const byte = value & 0x7f;
    value >>>= 7;
    out.push(byte | (value ? 0x80 : 0));
    if (!value) return out;
  }
}

/** Build an artifact the way the Python builder does, for round-trip testing. */
function artifact(rows: Array<[string, string, number]>): Uint8Array {
  const words = [...new Set(rows.flatMap(([a, b]) => [a, b]))].sort();
  const index = new Map(words.map((w, i) => [w, i]));
  const byHead = new Map<number, Array<[number, number]>>();
  for (const [a, b, score] of rows) {
    const list = byHead.get(index.get(a)!) ?? [];
    list.push([index.get(b)!, score]);
    byHead.set(index.get(a)!, list);
  }

  const head = encodeFrontCoded(words);
  const ids: number[] = [];
  const scores: number[] = [];
  for (let h = 0; h < words.length; h++) {
    const tails = (byHead.get(h) ?? []).sort((x, y) => x[0] - y[0]);
    ids.push(...varint(tails.length));
    let previous = 0;
    for (const [tail, score] of tails) {
      ids.push(...varint(tail - previous));
      previous = tail;
      scores.push(score);
    }
  }

  const count = rows.length;
  const out = new Uint8Array(head.length + 4 + ids.length + scores.length);
  out.set(head, 0);
  out.set([count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff], head.length);
  out.set(ids, head.length + 4);
  out.set(scores, head.length + 4 + ids.length);
  return out;
}

describe("decodeBigramTable", () => {
  it("round-trips heads, tails and scores", () => {
    const table = decodeBigramTable(
      artifact([["به", "من", 255], ["به", "تو", 128], ["از", "من", 51]]),
    );
    expect(table.size).toBe(2);
    expect(table.get("به")!.get("من")).toBeCloseTo(1, 6);
    expect(table.get("به")!.get("تو")).toBeCloseTo(128 / 255, 6);
    expect(table.get("از")!.get("من")).toBeCloseTo(51 / 255, 6);
    // A word that is only ever a tail gets no row of its own.
    expect(table.has("من")).toBe(false);
  });

  it("handles multi-byte varints, which is where an off-by-one would hide", () => {
    // 200 distinct tails on one head forces deltas and a count past 0x7f.
    const words = Array.from({ length: 200 }, (_, i) => `و${"ا".repeat(i % 7)}${i}`);
    const rows = words.map((w) => ["سر", w, ((w.length * 37) % 255) + 1] as [string, string, number]);
    const table = decodeBigramTable(artifact(rows));
    expect(table.get("سر")!.size).toBe(200);
    for (const [, tail, score] of rows) {
      expect(table.get("سر")!.get(tail)).toBeCloseTo(score / 255, 6);
    }
  });

  it("rejects a truncated artifact rather than returning silent garbage", () => {
    const bytes = artifact([["به", "من", 255], ["به", "تو", 128]]);
    expect(() => decodeBigramTable(bytes.slice(0, bytes.length - 1))).toThrow(/truncated/);
  });

  it("handles an empty table", () => {
    expect(decodeBigramTable(artifact([])).size).toBe(0);
  });
});

describe("bigramScore", () => {
  const table = decodeBigramTable(artifact([["به", "من", 255]]));

  it("returns 0 for a pair the table does not carry", () => {
    // Load-bearing: the artifact stores PMI precisely so that absent means
    // neutral. A negative default would make pruning promote what it removed.
    expect(bigramScore(table, "به", "او")).toBe(0);
    expect(bigramScore(table, "او", "من")).toBe(0);
  });

  it("returns 0 with no table at all", () => {
    expect(bigramScore(undefined, "به", "من")).toBe(0);
  });

  it("returns the stored association otherwise", () => {
    expect(bigramScore(table, "به", "من")).toBeCloseTo(1, 6);
  });
});

describe("the committed artifact", () => {
  const path = new URL("../data/lexicon/fa-bigram.bin", import.meta.url);

  it.skipIf(!existsSync(path))("decodes, and scores are in range", () => {
    const table = decodeBigramTable(brotliDecompressSync(readFileSync(path)));
    expect(table.size).toBeGreaterThan(1000);
    let pairs = 0;
    for (const row of table.values()) {
      for (const score of row.values()) {
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThanOrEqual(1);
        pairs++;
      }
    }
    expect(pairs).toBe(30000);
    expect(MAX_PMI).toBe(6);
  });
});

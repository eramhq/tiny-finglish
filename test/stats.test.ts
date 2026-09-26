/**
 * The significance check every ship decision quotes (`scripts/ab.ts`). A
 * wrong interval here would turn luck into a "real" win, so its basic
 * properties are pinned.
 */
import { describe, expect, it } from "vitest";
import { bootstrapCI, mulberry32, pairedBootstrap, verdict, type Counts } from "../scripts/_stats.ts";

/** `n` rows of `size` words, correct with probability `p`, from a fixed seed. */
function rows(n: number, size: number, p: number, seed: number): Counts[] {
  const random = mulberry32(seed);
  return Array.from({ length: n }, () => {
    let correct = 0;
    for (let i = 0; i < size; i++) if (random() < p) correct++;
    return { correct, total: size };
  });
}

describe("mulberry32", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const x = mulberry32(7), y = mulberry32(7), z = mulberry32(8);
    const xs = Array.from({ length: 5 }, x);
    expect(Array.from({ length: 5 }, y)).toEqual(xs);
    expect(Array.from({ length: 5 }, z)).not.toEqual(xs);
    for (const v of xs) expect(v >= 0 && v < 1).toBe(true);
  });
});

describe("bootstrapCI", () => {
  const data = rows(300, 6, 0.7, 1);

  it("gives the same interval for the same seed", () => {
    expect(bootstrapCI(data, { seed: 3 })).toEqual(bootstrapCI(data, { seed: 3 }));
  });

  it("brackets the point value", () => {
    const ci = bootstrapCI(data);
    const correct = data.reduce((n, r) => n + r.correct, 0);
    expect(ci.value).toBeCloseTo(correct / (data.length * 6), 12);
    expect(ci.lo).toBeLessThanOrEqual(ci.value);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.value);
    expect(ci.hi - ci.lo).toBeGreaterThan(0);
  });
});

describe("pairedBootstrap", () => {
  it("finds no difference between identical engines", () => {
    const a = rows(300, 6, 0.7, 1);
    const p = pairedBootstrap(a, a.map((r) => ({ ...r })));
    expect(p.delta).toBe(0);
    expect(p.lo).toBeLessThanOrEqual(0);
    expect(p.hi).toBeGreaterThanOrEqual(0);
    expect(p.pBetter).toBe(0);
    expect(verdict(p)).toBe("within noise");
  });

  it("calls a clear separation real", () => {
    const a = rows(300, 6, 0.6, 1);
    const b = a.map((r) => ({ correct: Math.min(r.total, r.correct + 1), total: r.total }));
    const p = pairedBootstrap(a, b);
    expect(p.delta).toBeGreaterThan(0);
    expect(p.lo).toBeGreaterThan(0);
    expect(p.pBetter).toBe(1);
    expect(verdict(p)).toBe("real");
  });

  it("calls one changed row noise", () => {
    const a = rows(300, 6, 0.7, 1);
    const b = a.map((r, i) => (i === 0 ? { correct: Math.min(r.total, r.correct + 1), total: r.total } : r));
    expect(verdict(pairedBootstrap(a, b))).toBe("within noise");
  });

  it("is deterministic and rejects unpaired inputs", () => {
    const a = rows(100, 5, 0.5, 2), b = rows(100, 5, 0.55, 3);
    expect(pairedBootstrap(a, b)).toEqual(pairedBootstrap(a, b));
    expect(() => pairedBootstrap(a, b.slice(1))).toThrow();
  });
});

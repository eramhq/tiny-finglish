/**
 * Is a difference real, or luck? Bootstrap confidence intervals for word
 * accuracy. Eval-only; not part of the published package.
 *
 * Rows (sentences) are the resampling unit, not words: words in one sentence
 * share a context and an engine's mistakes in them are correlated, so treating
 * them as independent draws would make every interval too narrow.
 *
 * Seeded, so the same inputs always give the same interval — a number quoted
 * in a doc can be reproduced exactly.
 */

export interface Counts {
  correct: number;
  total: number;
}

export interface Interval {
  value: number;
  lo: number;
  hi: number;
}

export interface PairedInterval {
  /** Accuracy of `b` minus accuracy of `a`, on the full set. */
  delta: number;
  lo: number;
  hi: number;
  /** Share of resamples where `b` beat `a`. */
  pBetter: number;
}

export interface BootstrapOptions {
  resamples?: number;
  seed?: number;
}

/** A small seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function micro(rows: readonly Counts[]): number {
  let correct = 0;
  let total = 0;
  for (const r of rows) {
    correct += r.correct;
    total += r.total;
  }
  return total ? correct / total : 0;
}

/** The 2.5th and 97.5th percentiles of a sample. */
function percentile95(samples: number[]): [number, number] {
  samples.sort((x, y) => x - y);
  const at = (q: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.floor(q * samples.length)))]!;
  return [at(0.025), at(0.975)];
}

/** 95% CI for micro word accuracy, resampling rows with replacement. */
export function bootstrapCI(rows: readonly Counts[], options: BootstrapOptions = {}): Interval {
  const { resamples = 2000, seed = 42 } = options;
  const value = micro(rows);
  if (rows.length === 0) return { value, lo: value, hi: value };
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let k = 0; k < resamples; k++) {
    let correct = 0;
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[Math.floor(random() * rows.length)]!;
      correct += r.correct;
      total += r.total;
    }
    samples.push(total ? correct / total : 0);
  }
  const [lo, hi] = percentile95(samples);
  return { value, lo, hi };
}

/**
 * 95% CI for accuracy(b) − accuracy(a) on the same rows.
 *
 * Each resample draws one set of row indices and scores both engines on it, so
 * the noise both share — which sentences happened to be in the set — cancels,
 * and what is left is the difference the engines make.
 */
export function pairedBootstrap(
  a: readonly Counts[],
  b: readonly Counts[],
  options: BootstrapOptions = {},
): PairedInterval {
  if (a.length !== b.length) throw new Error(`pairedBootstrap: ${a.length} rows vs ${b.length}`);
  const { resamples = 2000, seed = 42 } = options;
  const delta = micro(b) - micro(a);
  if (a.length === 0) return { delta, lo: delta, hi: delta, pBetter: 0 };
  const random = mulberry32(seed);
  const samples: number[] = [];
  let better = 0;
  for (let k = 0; k < resamples; k++) {
    let ac = 0, at = 0, bc = 0, bt = 0;
    for (let i = 0; i < a.length; i++) {
      const j = Math.floor(random() * a.length);
      ac += a[j]!.correct;
      at += a[j]!.total;
      bc += b[j]!.correct;
      bt += b[j]!.total;
    }
    const d = (bt ? bc / bt : 0) - (at ? ac / at : 0);
    samples.push(d);
    if (d > 0) better++;
  }
  const [lo, hi] = percentile95(samples);
  return { delta, lo, hi, pBetter: better / resamples };
}

/** "real" when the interval excludes zero. */
export function verdict(interval: { lo: number; hi: number }): "real" | "within noise" {
  return interval.lo > 0 || interval.hi < 0 ? "real" : "within noise";
}

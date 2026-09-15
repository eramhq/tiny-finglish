/**
 * Beam decode — step [3] of the pipeline.
 *
 * The transducer is a tagger, so its per-position distributions are
 * conditionally independent given the input. A k-best search over their
 * product therefore has no recurrent state to carry, and "beam search" here
 * means: keep the `width` best label sequences while sweeping left to right.
 *
 * This is where the plan's promise of "alternatives and confidence for free"
 * is cashed. A generative decoder would have to be run k times to get k
 * candidates; a tagger gets them from one forward pass.
 */

import { softmax } from "./runtime.ts";

export interface Hypothesis {
  /** Concatenated Persian output. */
  output: string;
  /** Sum of per-position log probabilities. */
  logProb: number;
  /** Per-position label indices, same length as the input. */
  labels: number[];
}

export interface DecodeOptions {
  /** Beam width. */
  width?: number;
  /** How many labels to consider per position before pruning. */
  topKPerPosition?: number;
  /** Hypotheses to return. */
  results?: number;
  /**
   * Ignore labels whose probability is below this. Prevents the beam filling
   * with near-zero variants of the same word at long inputs.
   */
  minProbability?: number;
}

const DEFAULTS: Required<DecodeOptions> = {
  width: 8,
  topKPerPosition: 4,
  results: 3,
  minProbability: 1e-4,
};

/**
 * Decode `logits` (`[T, L]` row-major) into the best `results` hypotheses.
 *
 * `labelStrings` maps label index to its Persian output; index 0 is the empty
 * label, which is why a 6-character input can produce a 5-character word.
 */
export function beamDecode(
  logits: Float32Array,
  positions: number,
  labelCount: number,
  labelStrings: readonly string[],
  options: DecodeOptions = {},
): Hypothesis[] {
  const opts = { ...DEFAULTS, ...options };
  if (positions === 0) return [{ output: "", logProb: 0, labels: [] }];

  let beam: Hypothesis[] = [{ output: "", logProb: 0, labels: [] }];

  for (let t = 0; t < positions; t++) {
    const row = logits.slice(t * labelCount, (t + 1) * labelCount);
    softmax(row);
    const candidates = topK(row, opts.topKPerPosition, opts.minProbability);

    const next: Hypothesis[] = [];
    for (const hypothesis of beam) {
      for (const { index, probability } of candidates) {
        next.push({
          output: hypothesis.output + labelStrings[index]!,
          logProb: hypothesis.logProb + Math.log(probability),
          labels: [...hypothesis.labels, index],
        });
      }
    }
    // Distinct outputs only: many label paths spell the same word (an empty
    // label in one position versus the next), and duplicates would crowd out
    // genuinely different candidates.
    beam = dedupe(next).sort((a, b) => b.logProb - a.logProb).slice(0, opts.width);
  }

  return beam.slice(0, opts.results);
}

interface Scored {
  index: number;
  probability: number;
}

function topK(row: Float32Array, k: number, floor: number): Scored[] {
  const out: Scored[] = [];
  for (let i = 0; i < row.length; i++) {
    const probability = row[i]!;
    if (probability < floor) continue;
    if (out.length < k) {
      out.push({ index: i, probability });
      if (out.length === k) out.sort((a, b) => a.probability - b.probability);
    } else if (probability > out[0]!.probability) {
      out[0] = { index: i, probability };
      out.sort((a, b) => a.probability - b.probability);
    }
  }
  // Always return something: an all-below-floor position would otherwise kill
  // the beam entirely and lose the rest of the word.
  if (out.length === 0) {
    let best = 0;
    for (let i = 1; i < row.length; i++) if (row[i]! > row[best]!) best = i;
    out.push({ index: best, probability: Math.max(row[best]!, Number.MIN_VALUE) });
  }
  return out.sort((a, b) => b.probability - a.probability);
}

function dedupe(hypotheses: Hypothesis[]): Hypothesis[] {
  const best = new Map<string, Hypothesis>();
  for (const h of hypotheses) {
    const existing = best.get(h.output);
    if (!existing || h.logProb > existing.logProb) best.set(h.output, h);
  }
  return [...best.values()];
}

/**
 * Turn a hypothesis list into calibrated probabilities over the returned set.
 *
 * Two normalizations, deliberately different:
 *  - `probability` is the softmax over the returned candidates, so they sum to
 *    1 and can be shown as a distribution in the playground.
 *  - `confidence` is the *length-normalized* likelihood of the best path,
 *    `exp(logProb / positions)`. Without the length normalization a long word
 *    would always look less certain than a short one, which is an artifact of
 *    multiplying more numbers together rather than a real difference in doubt.
 */
export function scoreHypotheses(
  hypotheses: readonly Hypothesis[],
  positions: number,
): { probabilities: number[]; confidence: number } {
  if (hypotheses.length === 0) return { probabilities: [], confidence: 0 };
  const max = Math.max(...hypotheses.map((h) => h.logProb));
  const weights = hypotheses.map((h) => Math.exp(h.logProb - max));
  const total = weights.reduce((a, b) => a + b, 0);
  const probabilities = weights.map((w) => w / total);
  const confidence = positions > 0 ? Math.exp(hypotheses[0]!.logProb / positions) : 0;
  return { probabilities, confidence: clamp01(confidence) };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Tier [4] — lexicon snap. **Built but disabled by default**, per the plan's
 * M2 decision: the capacity arithmetic says the model should absorb the
 * vocabulary without shipping a lexicon at runtime, and `sweep.py` measures
 * whether that holds. Enable it only if the scaling curve says the model
 * cannot.
 *
 * Reorders candidates so attested words outrank unattested ones, without ever
 * inventing a candidate the model did not propose. It cannot rescue a word the
 * beam never considered, which is exactly why it is a reranker and not a
 * generator.
 */
export function snapToLexicon(
  hypotheses: readonly Hypothesis[],
  lexicon: ReadonlySet<string>,
  bonus = 1.5,
): Hypothesis[] {
  return hypotheses
    .map((h) => (lexicon.has(h.output) ? { ...h, logProb: h.logProb + bonus } : h))
    .sort((a, b) => b.logProb - a.logProb);
}

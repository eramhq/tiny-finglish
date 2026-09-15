/**
 * Hand-written inference — a line-for-line reimplementation of the PyTorch
 * forward pass in `training/tiny_finglish_training/model.py`.
 *
 * No ONNX Runtime, no WASM, no WebGPU. Reasons, in order of weight:
 *
 *  * **ONNX Runtime** is larger than this entire package by an order of
 *    magnitude. It stays useful as a correctness reference during
 *    experimentation, never as a dependency.
 *  * **WASM loses** for one-shot calls. V8 does not do on-stack replacement for
 *    WebAssembly, so a single inference completes in baseline (Liftoff) code
 *    and never tiers up, while the equivalent JS loop *does* OSR mid-loop into
 *    optimized code. The real comparison is optimized JS against unoptimized
 *    WASM. The call boundary is not the problem — it costs ~5 ns — the tiering
 *    is. A comparable project spends 23 KiB Brotli on its WASI shim alone,
 *    against ~5 KiB for an entire hand-written JS engine.
 *  * **WebGPU** pays dispatch overhead that dominates a single short sentence.
 *    The `backend: "auto"` option exists so a batch-threshold escalation can be
 *    added later without a breaking change.
 *
 * Everything is `Float32Array` and scalar loops. Matmuls use i-k-j ordering so
 * the inner loop walks both operands contiguously.
 */

import type { TensorMap } from "./quant.ts";

export interface RuntimeConfig {
  input_vocab: number;
  output_vocab: number;
  d_model: number;
  d_hidden: number;
  n_layers: number;
  context: number;
}

/**
 * Preallocated scratch for one forward pass. Reused across calls so the typing
 * path does not allocate per keystroke.
 */
interface Scratch {
  width: number;
  neighbourhood: Float32Array;
  hidden: Float32Array;
  gates: Float32Array;
  forward: Float32Array;
  backward: Float32Array;
  combined: Float32Array;
  projected: Float32Array;
  logits: Float32Array;
}

export class Transducer {
  readonly config: RuntimeConfig;
  private readonly weights: TensorMap;
  private scratch: Scratch | null = null;

  constructor(weights: TensorMap, config: RuntimeConfig) {
    this.weights = weights;
    this.config = config;
  }

  private tensor(name: string): Float32Array {
    const t = this.weights.get(name);
    if (!t) throw new Error(`missing weight tensor ${name}`);
    return t.data;
  }

  private ensureScratch(width: number): Scratch {
    const { d_model, d_hidden, output_vocab, context } = this.config;
    if (this.scratch && this.scratch.width >= width) return this.scratch;
    this.scratch = {
      width,
      neighbourhood: new Float32Array(width * (2 * context + 1) * d_model),
      hidden: new Float32Array(width * d_model),
      gates: new Float32Array(width * 4 * d_hidden),
      forward: new Float32Array(width * d_hidden),
      backward: new Float32Array(width * d_hidden),
      combined: new Float32Array(width * 2 * d_hidden),
      projected: new Float32Array(width * d_model),
      logits: new Float32Array(width * output_vocab),
    };
    return this.scratch;
  }

  /**
   * Run the transducer over `ids` and return logits as `[T, output_vocab]`
   * flattened row-major. The returned array is scratch memory owned by this
   * instance and is overwritten by the next call.
   */
  forward(ids: Int32Array | number[]): Float32Array {
    const { d_model, d_hidden, n_layers, output_vocab, context } = this.config;
    const T = ids.length;
    const s = this.ensureScratch(Math.max(T, 1));
    const width = 2 * context + 1;

    // 1. Embedding lookup into the neighbourhood buffer, zero-padded at the
    //    edges so position t never sees the opposite end of the sequence.
    const embed = this.tensor("embed.weight");
    const neighbourhood = s.neighbourhood.subarray(0, T * width * d_model);
    neighbourhood.fill(0);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < width; k++) {
        const src = t + k - context;
        if (src < 0 || src >= T) continue;
        const row = ids[src]! * d_model;
        neighbourhood.set(embed.subarray(row, row + d_model), (t * width + k) * d_model);
      }
    }

    // 2. Neighbourhood projection + ReLU.
    const x = s.hidden.subarray(0, T * d_model);
    affine(
      neighbourhood, T, width * d_model,
      this.tensor("neighbourhood.weight"), this.tensor("neighbourhood.bias"),
      d_model, x,
    );
    for (let i = 0; i < x.length; i++) if (x[i]! < 0) x[i] = 0;

    // 3. Bidirectional affine-scan layers.
    for (let layer = 0; layer < n_layers; layer++) {
      const prefix = `layers.${layer}.`;
      const gates = s.gates.subarray(0, T * 4 * d_hidden);
      affine(
        x, T, d_model,
        this.tensor(`${prefix}proj.weight`), this.tensor(`${prefix}proj.bias`),
        4 * d_hidden, gates,
      );

      const hf = s.forward.subarray(0, T * d_hidden);
      const hb = s.backward.subarray(0, T * d_hidden);
      scan(gates, T, d_hidden, 0, hf, false);
      scan(gates, T, d_hidden, 2 * d_hidden, hb, true);

      // Interleave into [hf | hb] per position, matching torch.cat(dim=-1).
      const combined = s.combined.subarray(0, T * 2 * d_hidden);
      for (let t = 0; t < T; t++) {
        combined.set(hf.subarray(t * d_hidden, (t + 1) * d_hidden), t * 2 * d_hidden);
        combined.set(hb.subarray(t * d_hidden, (t + 1) * d_hidden), t * 2 * d_hidden + d_hidden);
      }

      const projected = s.projected.subarray(0, T * d_model);
      affine(
        combined, T, 2 * d_hidden,
        this.tensor(`${prefix}out.weight`), this.tensor(`${prefix}out.bias`),
        d_model, projected,
      );

      // Residual, then RMSNorm. Written in place over `x`.
      const gain = this.tensor(`${prefix}norm.weight`);
      for (let t = 0; t < T; t++) {
        const base = t * d_model;
        let sum = 0;
        for (let i = 0; i < d_model; i++) {
          const v = x[base + i]! + projected[base + i]!;
          x[base + i] = v;
          sum += v * v;
        }
        const scale = 1 / Math.sqrt(sum / d_model + 1e-5);
        for (let i = 0; i < d_model; i++) x[base + i] = x[base + i]! * scale * gain[i]!;
      }
    }

    // 4. Output projection.
    const logits = s.logits.subarray(0, T * output_vocab);
    affine(x, T, d_model, this.tensor("head.weight"), this.tensor("head.bias"), output_vocab, logits);
    return logits;
  }
}

/**
 * `out[t, o] = sum_i input[t, i] * weight[o, i] + bias[o]`
 *
 * `weight` is stored `[out, in]`, matching PyTorch's `nn.Linear.weight`, so the
 * inner loop walks one weight row contiguously.
 */
function affine(
  input: Float32Array,
  rows: number,
  inFeatures: number,
  weight: Float32Array,
  bias: Float32Array,
  outFeatures: number,
  out: Float32Array,
): void {
  for (let t = 0; t < rows; t++) {
    const inBase = t * inFeatures;
    const outBase = t * outFeatures;
    for (let o = 0; o < outFeatures; o++) {
      const wBase = o * inFeatures;
      let acc = bias[o]!;
      for (let i = 0; i < inFeatures; i++) acc += input[inBase + i]! * weight[wBase + i]!;
      out[outBase + o] = acc;
    }
  }
}

/**
 * The convex affine scan: `h[t] = a[t] * h[t-1] + (1 - a[t]) * v[t]`, with
 * `a = sigmoid(gate)`.
 *
 * `gates` holds four streams per position; `offset` selects which pair. The
 * convex form bounds `|h|` by `max|v|`, which is what keeps this loop from
 * drifting away from PyTorch's over long inputs and what makes the quantized
 * weights behave.
 */
function scan(
  gates: Float32Array,
  rows: number,
  hidden: number,
  offset: number,
  out: Float32Array,
  reverse: boolean,
): void {
  const stride = 4 * hidden;
  const h = new Float32Array(hidden);
  const start = reverse ? rows - 1 : 0;
  const end = reverse ? -1 : rows;
  const step = reverse ? -1 : 1;
  for (let t = start; t !== end; t += step) {
    const base = t * stride + offset;
    const outBase = t * hidden;
    for (let i = 0; i < hidden; i++) {
      const a = 1 / (1 + Math.exp(-gates[base + i]!));
      const v = gates[base + hidden + i]!;
      const next = a * h[i]! + (1 - a) * v;
      h[i] = next;
      out[outBase + i] = next;
    }
  }
}

/** Numerically stable softmax over one row, in place. */
export function softmax(row: Float32Array): void {
  let max = -Infinity;
  for (let i = 0; i < row.length; i++) if (row[i]! > max) max = row[i]!;
  let sum = 0;
  for (let i = 0; i < row.length; i++) {
    const v = Math.exp(row[i]! - max);
    row[i] = v;
    sum += v;
  }
  for (let i = 0; i < row.length; i++) row[i] = row[i]! / sum;
}

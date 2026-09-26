/**
 * Weight artifact decoding — the browser half of `training/.../export.py`.
 *
 * Reads the `tiny-finglish-weights/1` artifact into named `Float32Array`s.
 * Every choice here mirrors the exporter exactly, because the parity fixtures
 * assert that PyTorch and this file produce the same logits.
 *
 * Unpacking is a linear scan: single-digit milliseconds at half a million
 * parameters, done once at init and then cached.
 */

/** Must match `INT6_ALPHABET` in `export.py`. */
const INT6_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-".slice(0, 63);
const QMAX: Record<string, number> = { int8: 127, int6: 31 };

export interface TensorRecord {
  name: string;
  shape: number[];
  kind: "quantized" | "float32";
  scales?: number[];
}

export interface WeightArtifact {
  format: string;
  quant: "int8" | "int6";
  alphabet: string;
  config: {
    input_vocab: number;
    output_vocab: number;
    d_model: number;
    d_hidden: number;
    n_layers: number;
    context: number;
  };
  vocab: { input: string[]; output: string[] };
  /**
   * The model was trained with `<eos>` after clause-final words, and expects it
   * (`train.py --surgery-from`). Absent on older weights, which never get it.
   */
  clauseMarker?: boolean;
  tensors: TensorRecord[];
  payload: string[];
}

export interface Tensor {
  data: Float32Array;
  shape: number[];
}

export type TensorMap = ReadonlyMap<string, Tensor>;

/** Reverse lookup for the int6 alphabet, built once. */
const INT6_CODES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < INT6_ALPHABET.length; i++) table[INT6_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function decodeArtifact(artifact: WeightArtifact): TensorMap {
  if (artifact.format !== "tiny-finglish-weights/1") {
    throw new Error(`unsupported weight format ${artifact.format}`);
  }
  const qmax = QMAX[artifact.quant];
  if (qmax === undefined) throw new Error(`unsupported quantization ${artifact.quant}`);
  if (artifact.tensors.length !== artifact.payload.length) {
    throw new Error("weight artifact is corrupt: tensor and payload counts differ");
  }

  const tensors = new Map<string, Tensor>();
  for (let i = 0; i < artifact.tensors.length; i++) {
    const record = artifact.tensors[i]!;
    const chunk = artifact.payload[i]!;
    const count = record.shape.reduce((a, b) => a * b, 1);
    const data =
      record.kind === "float32"
        ? decodeFloat32(chunk, count)
        : dequantize(chunk, record, artifact.quant, qmax, count);
    tensors.set(record.name, { data, shape: record.shape });
  }
  return tensors;
}

function dequantize(
  chunk: string,
  record: TensorRecord,
  quant: string,
  qmax: number,
  count: number,
): Float32Array {
  const scales = record.scales;
  if (!scales) throw new Error(`quantized tensor ${record.name} has no scales`);
  const rows = record.shape[0]!;
  const columns = count / rows;
  const out = new Float32Array(count);

  if (quant === "int6") {
    // One character per weight. Larger than bit-packing before compression and
    // smaller after it — see the exporter's module docstring.
    if (chunk.length !== count) {
      throw new Error(`tensor ${record.name}: expected ${count} symbols, got ${chunk.length}`);
    }
    for (let r = 0; r < rows; r++) {
      const scale = scales[r]!;
      const base = r * columns;
      for (let c = 0; c < columns; c++) {
        const code = INT6_CODES[chunk.charCodeAt(base + c)]!;
        if (code < 0) throw new Error(`tensor ${record.name}: bad symbol at ${base + c}`);
        out[base + c] = (code - qmax) * scale;
      }
    }
    return out;
  }

  const bytes = decodeBase64(chunk);
  if (bytes.length !== count) {
    throw new Error(`tensor ${record.name}: expected ${count} bytes, got ${bytes.length}`);
  }
  for (let r = 0; r < rows; r++) {
    const scale = scales[r]!;
    const base = r * columns;
    for (let c = 0; c < columns; c++) out[base + c] = (bytes[base + c]! - qmax) * scale;
  }
  return out;
}

function decodeFloat32(chunk: string, count: number): Float32Array {
  const bytes = decodeBase64(chunk);
  // Copy into a fresh buffer rather than viewing `bytes.buffer`: a Float32Array
  // view needs a 4-byte-aligned offset and throws RangeError otherwise, and the
  // base64 decode gives no alignment guarantee.
  const out = new Float32Array(count);
  new Uint8Array(out.buffer).set(bytes.subarray(0, count * 4));
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_CODES = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) table[BASE64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Base64 without `atob` or `Buffer`.
 *
 * `atob` exists everywhere this runs, but depending on it would put a DOM
 * symbol in a package that is otherwise environment-free, and `Buffer` would
 * put a Node symbol in a browser build. Fifteen lines removes both.
 */
function decodeBase64(text: string): Uint8Array {
  let length = text.length;
  while (length > 0 && text[length - 1] === "=") length--;
  const bytes = new Uint8Array((length * 3) >> 2);

  let accumulator = 0;
  let bits = 0;
  let out = 0;
  for (let i = 0; i < length; i++) {
    const code = BASE64_CODES[text.charCodeAt(i)] ?? -1;
    if (code < 0) throw new Error(`invalid base64 at offset ${i}`);
    accumulator = (accumulator << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (accumulator >> bits) & 0xff;
    }
  }
  return bytes;
}

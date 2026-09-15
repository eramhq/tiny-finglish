/**
 * Weight-artifact decoding.
 *
 * `scripts/parity.ts` covers the int8 path end to end against PyTorch, but the
 * int6 path — one ASCII character per weight from a 63-symbol alphabet — is the
 * unusual one and deserves a direct test. A silent misdecode there would look
 * like a model that trained badly rather than a codec bug.
 */
import { describe, expect, it } from "vitest";
import { decodeArtifact, type WeightArtifact } from "../src/quant.ts";

const INT6_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-".slice(0, 63);
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : BASE64[c & 63];
  }
  return out;
}

function float32Base64(values: number[]): string {
  const floats = Float32Array.from(values);
  return base64([...new Uint8Array(floats.buffer)]);
}

function artifact(overrides: Partial<WeightArtifact> = {}): WeightArtifact {
  return {
    format: "tiny-finglish-weights/1",
    quant: "int8",
    alphabet: "base64",
    config: { input_vocab: 2, output_vocab: 2, d_model: 2, d_hidden: 2, n_layers: 0, context: 2 },
    vocab: { input: ["a", "b"], output: ["", "ا"] },
    tensors: [],
    payload: [],
    ...overrides,
  };
}

describe("decodeArtifact", () => {
  it("applies per-row scales to int8 codes", () => {
    // Codes are stored shifted by qmax=127, so 127 is zero.
    const decoded = decodeArtifact(artifact({
      quant: "int8",
      tensors: [{ name: "w", shape: [2, 2], kind: "quantized", scales: [0.5, 2] }],
      payload: [base64([127 + 2, 127 - 4, 127 + 1, 127 - 3])],
    }));
    // Row 0 uses scale 0.5, row 1 uses scale 2 — this is the assertion that
    // catches a tensor-wide scale being applied by mistake.
    expect([...decoded.get("w")!.data]).toEqual([1, -2, 2, -6]);
  });

  it("decodes int6 from the ASCII alphabet with per-row scales", () => {
    // qmax=31, so alphabet index 31 is zero.
    const symbols = [31 + 2, 31 - 4, 31 + 1, 31 - 3].map((c) => INT6_ALPHABET[c]!).join("");
    const decoded = decodeArtifact(artifact({
      quant: "int6",
      alphabet: INT6_ALPHABET,
      tensors: [{ name: "w", shape: [2, 2], kind: "quantized", scales: [0.5, 2] }],
      payload: [symbols],
    }));
    expect([...decoded.get("w")!.data]).toEqual([1, -2, 2, -6]);
  });

  it("covers the full int6 code range without drift", () => {
    const symbols = INT6_ALPHABET;
    const decoded = decodeArtifact(artifact({
      quant: "int6",
      alphabet: INT6_ALPHABET,
      tensors: [{ name: "w", shape: [1, 63], kind: "quantized", scales: [1] }],
      payload: [symbols],
    }));
    expect([...decoded.get("w")!.data]).toEqual(
      Array.from({ length: 63 }, (_, i) => i - 31),
    );
  });

  it("round-trips float32 tensors through base64", () => {
    const values = [0, 1, -1, 0.5, 1e-8, 3.4e38, -3.4e38];
    const decoded = decodeArtifact(artifact({
      tensors: [{ name: "b", shape: [values.length], kind: "float32" }],
      payload: [float32Base64(values)],
    }));
    const got = [...decoded.get("b")!.data];
    for (let i = 0; i < values.length; i++) {
      expect(got[i]!).toBeCloseTo(Math.fround(values[i]!), 10);
    }
  });

  it("decodes float32 regardless of byte alignment", () => {
    // A Float32Array view over an unaligned offset throws RangeError, so the
    // decoder must copy. Three tensors of differing length force misalignment.
    const decoded = decodeArtifact(artifact({
      tensors: [
        { name: "x", shape: [1], kind: "float32" },
        { name: "y", shape: [3], kind: "float32" },
        { name: "z", shape: [2], kind: "float32" },
      ],
      payload: [float32Base64([1]), float32Base64([2, 3, 4]), float32Base64([5, 6])],
    }));
    expect([...decoded.get("x")!.data]).toEqual([1]);
    expect([...decoded.get("y")!.data]).toEqual([2, 3, 4]);
    expect([...decoded.get("z")!.data]).toEqual([5, 6]);
  });

  it("rejects a corrupt or unsupported artifact rather than decoding garbage", () => {
    expect(() => decodeArtifact(artifact({ format: "something-else" }))).toThrow(/format/);
    expect(() => decodeArtifact(artifact({ quant: "int3" as "int8" }))).toThrow(/quantization/);
    expect(() =>
      decodeArtifact(artifact({
        tensors: [{ name: "w", shape: [1, 2], kind: "quantized", scales: [1] }],
        payload: [],
      })),
    ).toThrow(/corrupt/);
    expect(() =>
      decodeArtifact(artifact({
        quant: "int6",
        tensors: [{ name: "w", shape: [1, 2], kind: "quantized", scales: [1] }],
        payload: ["A"],
      })),
    ).toThrow(/expected 2 symbols/);
    expect(() =>
      decodeArtifact(artifact({
        quant: "int6",
        tensors: [{ name: "w", shape: [1, 2], kind: "quantized", scales: [1] }],
        payload: ["A!"],
      })),
    ).toThrow(/bad symbol/);
  });
});

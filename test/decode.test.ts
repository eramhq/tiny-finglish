/**
 * Beam decode. The properties that matter are that it never loses the argmax
 * path, that it returns distinct candidates, and that confidence is
 * length-normalized so a long word is not penalised for being long.
 */
import { describe, expect, it } from "vitest";
import { beamDecode, scoreHypotheses, snapToLexicon } from "../src/decode.ts";

/** Build a [T, L] logit block from per-position label scores. */
function logits(rows: number[][]): Float32Array {
  return Float32Array.from(rows.flat());
}

const labels = ["", "ا", "ب", "پ"];

describe("beamDecode", () => {
  it("returns the greedy path first", () => {
    const out = beamDecode(logits([[0, 5, 0, 0], [0, 0, 5, 0]]), 2, 4, labels);
    expect(out[0]!.output).toBe("اب");
  });

  it("uses the empty label to shorten the output", () => {
    // Two input characters, one Persian character out.
    const out = beamDecode(logits([[0, 5, 0, 0], [5, 0, 0, 0]]), 2, 4, labels);
    expect(out[0]!.output).toBe("ا");
  });

  it("returns distinct outputs, not duplicate label paths", () => {
    const out = beamDecode(logits([[2, 2, 0, 0], [2, 2, 0, 0]]), 2, 4, labels, { results: 4 });
    expect(new Set(out.map((h) => h.output)).size).toBe(out.length);
  });

  it("ranks by total log probability", () => {
    const out = beamDecode(logits([[0, 3, 2, 0], [0, 3, 2, 0]]), 2, 4, labels, { results: 3 });
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.logProb).toBeGreaterThanOrEqual(out[i]!.logProb);
    }
  });

  it("handles empty input", () => {
    expect(beamDecode(new Float32Array(0), 0, 4, labels)[0]!.output).toBe("");
  });

  it("never returns an empty beam, even when every label is below the floor", () => {
    const out = beamDecode(logits([[0, 0, 0, 0]]), 1, 4, labels, { minProbability: 0.99 });
    expect(out.length).toBeGreaterThan(0);
  });

  it("does not degrade on long inputs", () => {
    const rows = Array.from({ length: 40 }, () => [0, 5, 1, 1]);
    const out = beamDecode(logits(rows), 40, 4, labels);
    expect(out[0]!.output).toBe("ا".repeat(40));
  });
});

describe("scoreHypotheses", () => {
  it("normalizes probabilities over the returned set", () => {
    const hypotheses = [
      { output: "a", logProb: Math.log(0.6), labels: [] },
      { output: "b", logProb: Math.log(0.3), labels: [] },
    ];
    const { probabilities } = scoreHypotheses(hypotheses, 1);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(probabilities[0]!).toBeGreaterThan(probabilities[1]!);
  });

  it("length-normalizes confidence so long words are not penalised", () => {
    const perChar = Math.log(0.9);
    const short = scoreHypotheses([{ output: "ab", logProb: perChar * 2, labels: [] }], 2);
    const long = scoreHypotheses([{ output: "abcdefgh", logProb: perChar * 8, labels: [] }], 8);
    expect(short.confidence).toBeCloseTo(long.confidence, 6);
    expect(short.confidence).toBeCloseTo(0.9, 6);
  });

  it("clamps confidence into [0,1]", () => {
    const { confidence } = scoreHypotheses([{ output: "x", logProb: 5, labels: [] }], 1);
    expect(confidence).toBeLessThanOrEqual(1);
  });
});

describe("snapToLexicon", () => {
  it("promotes an attested candidate above an unattested leader", () => {
    const out = snapToLexicon(
      [
        { output: "سلم", logProb: -0.5, labels: [] },
        { output: "سلام", logProb: -1.5, labels: [] },
      ],
      new Set(["سلام"]),
    );
    expect(out[0]!.output).toBe("سلام");
  });

  it("never invents a candidate the decoder did not propose", () => {
    const input = [{ output: "سلم", logProb: -0.5, labels: [] }];
    const out = snapToLexicon(input, new Set(["سلام", "کتاب"]));
    expect(out.map((h) => h.output)).toEqual(["سلم"]);
  });
});

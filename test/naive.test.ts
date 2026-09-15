/**
 * The naive floor.
 *
 * These tests pin its *contract*, not its accuracy. The point of the floor is
 * that it is dumb in a specific, reproducible way — one greedy pass, one answer
 * per unit — so the comparison page can attribute the gap above it to search
 * and ranking rather than to better letter rules. A test that asserted it got
 * words right would be testing the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { naiveTransliterate, naiveWord } from "../src/naive.ts";
import { RuleBaseline } from "../src/baseline.ts";
import { loadFrequency } from "../scripts/_load.ts";

describe("naiveWord", () => {
  it("prefers the longest Latin unit over two short ones", () => {
    // "sh"/"kh"/"oo" must win over s+h, k+h, o+o.
    expect(naiveWord("sh")).toBe("ش");
    expect(naiveWord("khoobi")).toBe("خوبی");
    expect(naiveWord("mikonam")).toBe("میکنم");
  });

  it("is deterministic and total — every input produces an output", () => {
    for (const word of ["salam", "zzzz", "q", "", "aeiou", "xyz"]) {
      expect(naiveWord(word)).toBe(naiveWord(word));
      expect(typeof naiveWord(word)).toBe("string");
    }
  });

  it("passes through characters no rule covers rather than dropping them", () => {
    // Digits are not Latin units; the walk must still terminate and keep them.
    expect(naiveWord("a1b")).toContain("1");
  });

  it("is case-insensitive", () => {
    expect(naiveWord("SALAM")).toBe(naiveWord("salam"));
  });

  it("drops the unwritten short vowels, which is the floor's defining failure", () => {
    // salam -> سلم, not سلام. A single highest-weight choice per unit cannot
    // know that this particular "a" is written and the other is not.
    expect(naiveWord("salam")).toBe("سلم");
  });
});

describe("naiveTransliterate", () => {
  it("converts Latin runs and leaves everything else in place", () => {
    expect(naiveTransliterate("salam, man")).toBe("سلم, من");
    expect(naiveTransliterate("25")).toBe("25");
  });

  it("mangles URLs, unlike the real pipeline", () => {
    // This is the measured differentiator the comparison page reports, so it is
    // worth pinning: the floor has no tokenizer and cannot protect anything.
    const url = "https://example.ir/a?b=1";
    expect(naiveTransliterate(url)).not.toBe(url);
  });
});

describe("the floor relative to the rule baseline", () => {
  it("agrees with an unequipped RuleBaseline on the short-vowel failure", () => {
    // Worth pinning because it locates the gain precisely. Stripped of its
    // lexicon and frequency table, the baseline's segmentation search and beam
    // buy nothing on "salam" — it ranks سلم first for the same reason the floor
    // does, which is the finding already recorded in baseline.ts's
    // FREQUENCY_BONUS comment. The search is not what fixes this word.
    const bare = new RuleBaseline();
    expect(bare.transliterate("salam")[0]?.output).toBe(naiveWord("salam"));
  });

  it("diverges from the floor once the baseline has frequency", () => {
    // ...and this is what separates them. Note what it is *not*: an assertion
    // that the baseline is then right. It ranks سالم first here, which is a real
    // Persian word and the wrong one — سلام was meant. Frequency moves the
    // answer off the floor's answer; it does not make it correct. The
    // comparison page reports that gap as measured accuracy rather than
    // implying the ranking is sound.
    const frequency = loadFrequency();
    if (!frequency) return; // artifact absent in a bare checkout
    const ranked = new RuleBaseline({ frequency });
    expect(ranked.transliterate("salam")[0]?.output).not.toBe(naiveWord("salam"));
  });
});

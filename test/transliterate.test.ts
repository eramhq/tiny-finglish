/**
 * The public contract, plus the fixture-suite gates that must not regress.
 *
 * Accuracy thresholds here are deliberately loose and set *below* current
 * measured performance. They are regression guards, not targets — a test that
 * pins the exact current number turns every legitimate improvement into a
 * failing build.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Transliterator, transliterate } from "../src/index.ts";
import { buildFixtureReport, characterErrorRate } from "../scripts/_report.ts";
import { loadFrequency, loadLexicon, loadModel } from "../scripts/_load.ts";

const hasWeights = existsSync(new URL("../data/fixtures/weights.json", import.meta.url));

describe("transliterate contract", () => {
  it("returns the documented shape", () => {
    const result = transliterate("salam, man emrooz miram Muscat");
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("alternatives");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("spans");
    expect(Array.isArray(result.alternatives)).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("concatenating span outputs reproduces text exactly", () => {
    for (const input of [
      "salam, man emrooz miram Muscat",
      "ali@example.com ro check kon",
      "farda saat 8 miam",
      "",
    ]) {
      const result = transliterate(input);
      expect(result.spans.map((s) => s.output).join("")).toBe(result.text);
    }
  });

  it("span offsets index back into the original input", () => {
    const input = "salam, man emrooz miram Muscat";
    for (const span of transliterate(input).spans) {
      expect(input.slice(span.start, span.end)).toBe(span.input);
    }
  });

  it("works with no model and no lexicon", () => {
    const bare = new Transliterator();
    expect(bare.hasModel).toBe(false);
    expect(bare.transliterate("salam").text.length).toBeGreaterThan(0);
  });

  it("every converted span carries inspectable candidates with reasons", () => {
    for (const span of transliterate("salam emrooz").spans) {
      if (span.action !== "convert") continue;
      expect(span.candidates!.length).toBeGreaterThan(0);
      expect(span.candidates![0]!.output).toBe(span.output);
      for (const candidate of span.candidates!) {
        expect(candidate.reason.length).toBeGreaterThan(0);
        expect(candidate.probability).toBeGreaterThanOrEqual(0);
        expect(candidate.probability).toBeLessThanOrEqual(1);
      }
    }
  });

  it("alternatives never repeat the primary text", () => {
    const result = transliterate("salam man emrooz");
    expect(result.alternatives).not.toContain(result.text);
    expect(new Set(result.alternatives).size).toBe(result.alternatives.length);
  });

  it("preserves protected spans byte-identically inside a sentence", () => {
    const result = transliterate("in link https://example.ir/a?b=1 va ali@example.com ro bebin");
    expect(result.text).toContain("https://example.ir/a?b=1");
    expect(result.text).toContain("ali@example.com");
  });

  it("does not throw on adversarial input", () => {
    for (const input of ["", "   ", "!!!", "a".repeat(500), "\n\n", "\u{1F600}", "؟؟؟"]) {
      expect(() => transliterate(input), JSON.stringify(input)).not.toThrow();
    }
  });
});

describe("characterErrorRate", () => {
  it("is 0 for identical strings and 1 for a full replacement", () => {
    expect(characterErrorRate("سلام", "سلام")).toBe(0);
    expect(characterErrorRate("ابج", "خدذ")).toBe(1);
  });

  it("counts a single substitution proportionally", () => {
    expect(characterErrorRate("ابج", "ابد")).toBeCloseTo(1 / 3, 6);
  });

  it("handles the empty cases", () => {
    expect(characterErrorRate("", "")).toBe(0);
    expect(characterErrorRate("", "اب")).toBe(1);
  });
});

describe("fixture suite gates", () => {
  const report = buildFixtureReport({ useModel: hasWeights });

  // The single most important guard in the file. Mangling a URL or an email is
  // the failure the plan's risk register ranks as the fastest way to lose users,
  // so this one is pinned at 100% and is allowed no slack at all.
  it("preserves every copy span byte-identically", () => {
    expect(report.totals.copyPreserved).toBe(report.totals.copyTotal);
    expect(report.totals.copyTotal).toBeGreaterThan(15);
  });

  it("converts every protected fixture without touching it", () => {
    for (const c of report.cases) {
      if (c.fixture.expectAction !== "copy") continue;
      expect(c.result.text, c.fixture.id).toBe(c.fixture.input);
    }
  });

  it("clears the regression floor on top-1 accuracy", () => {
    const rate = report.totals.top1 / report.totals.count;
    expect(rate).toBeGreaterThan(0.5);
  });

  it("clears the regression floor on top-3 recall", () => {
    const rate = report.totals.top3 / report.totals.count;
    expect(rate).toBeGreaterThan(0.65);
  });

  it("keeps mean character error rate low", () => {
    expect(report.totals.cer / report.totals.count).toBeLessThan(0.25);
  });

  it("never regresses to zero on any category", () => {
    for (const [category, bucket] of report.byCategory) {
      expect(bucket.top1, `category ${category} scored nothing`).toBeGreaterThan(0);
    }
  });
});

/**
 * The hybrid path — both engines run, arbitrated per word.
 *
 * Off by default, because the gold set it would be judged on contains no ZWNJ
 * at all and the headline metric therefore charges the model three points for
 * placing one correctly. What is pinned here is the arbitration itself, which
 * has exactly one rule and must keep it.
 */
describe("hybrid arbitration", () => {
  const ZWNJ = "‌";
  const model = loadModel();
  const lexicon = loadLexicon();
  const frequency = loadFrequency();

  it.skipIf(!model)("prefers the model where only it can emit a ZWNJ", () => {
    const shared = { ...(lexicon ? { lexicon } : {}), ...(frequency ? { frequency } : {}) };
    const rules = new Transliterator(shared);
    const hybrid = new Transliterator({ ...shared, model: model!, hybrid: true });
    // `mikonam` is the clearest case: rule tables can only produce U+200C from
    // a literal space or hyphen in the Latin, so they spell میکنم solid.
    expect(rules.transliterate("mikonam").text).not.toContain(ZWNJ);
    expect(hybrid.transliterate("mikonam").text).toContain(ZWNJ);
  });

  it.skipIf(!model)("otherwise keeps the rule baseline, which wins on real input", () => {
    const shared = { ...(lexicon ? { lexicon } : {}), ...(frequency ? { frequency } : {}) };
    const rules = new Transliterator(shared);
    const hybrid = new Transliterator({ ...shared, model: model!, hybrid: true });
    for (const word of ["salam", "ketab", "mardom", "shahr"]) {
      const viaRules = rules.transliterate(word).text;
      if (viaRules.includes(ZWNJ)) continue;
      expect(hybrid.transliterate(word).text, word).toBe(viaRules);
    }
  });

  it.skipIf(!model)("keeps the losing engine's proposals as lower-ranked candidates", () => {
    const hybrid = new Transliterator({
      model: model!, ...(lexicon ? { lexicon } : {}), ...(frequency ? { frequency } : {}), hybrid: true,
    });
    const span = hybrid.transliterate("mikonam").spans.find((s) => s.action === "convert");
    // Two generators that disagree about what is even possible is most of the
    // value of running both; dropping the loser's list would throw it away.
    expect(span?.candidates?.length).toBeGreaterThan(1);
  });
});

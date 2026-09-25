/**
 * The word-final ه decision, asserted row by row.
 *
 * The fixture suite gates corpus-wide thresholds, so a change that broke every
 * ezafe row at once would move `all` by half a point and fail nothing. These
 * are the rows themselves, on the engine that ships them, plus the two shapes
 * the scoring term must not take: a rule that always writes the ه, and a rule
 * that never does.
 *
 * Read with `src/pipeline.ts`'s `finalHePass` and `SCORING.finalHe`.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Transliterator, RuleTransliterator } from "../src/index.ts";
import { loadFrequency, loadLexicon, loadModel } from "../scripts/_load.ts";
import { SCORING } from "../src/baseline.ts";

const root = new URL("..", import.meta.url);
const hasWeights = existsSync(new URL("data/fixtures/weights.json", root));

const fixtures = new Map<string, { input: string; expected: string }>(
  readFileSync(new URL("data/fixtures/fixtures.jsonl", root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; input: string; expected: string })
    .filter((row) => row.id.startsWith("ezafe-"))
    .map((row) => [row.id, { input: row.input, expected: row.expected }]),
);

const shared = {
  ...(loadLexicon() ? { lexicon: loadLexicon()! } : {}),
  ...(loadFrequency() ? { frequency: loadFrequency()! } : {}),
};
const rules = new RuleTransliterator(shared);
const hybrid = hasWeights
  ? new Transliterator({ ...shared, model: loadModel()!, hybrid: true })
  : undefined;

/** The fixture rows the rule and hybrid tiers are both expected to get exactly. */
const EXACT = ["ezafe-001", "ezafe-003", "ezafe-004", "ezafe-005"] as const;

describe("word-final ه", () => {
  it("has the ezafe fixtures to assert", () => {
    expect(fixtures.size).toBe(5);
  });

  for (const id of EXACT) {
    it(`${id} on the rules tier`, () => {
      const row = fixtures.get(id)!;
      expect(rules.transliterate(row.input).text).toBe(row.expected);
    });
  }

  it.skipIf(!hybrid)("the copula rows on the hybrid tier", () => {
    for (const id of ["ezafe-001", "ezafe-004", "ezafe-005"] as const) {
      const row = fixtures.get(id)!;
      expect(hybrid!.transliterate(row.input).text, id).toBe(row.expected);
    }
  });

  /**
   * ezafe-002 is the documented miss, and this pins *where* it misses. کتابه is
   * generated and ranked; it is not chosen, because it is absent from the
   * frequency table and starts ~5.5 nats behind کتاب. If a later change closes
   * that gap this test fails and the fixture starts passing, which is the
   * outcome we want to be told about.
   */
  it("proposes the noun-plus-copula reading it cannot yet rank first", () => {
    const row = fixtures.get("ezafe-002")!;
    const result = rules.transliterate(row.input, { candidatesPerSpan: 8 });
    const last = result.spans.filter((s) => s.action === "convert").at(-1)!;
    expect(last.candidates!.map((c) => c.output)).toContain("کتابه");
    expect(result.text).not.toBe(row.expected);
  });

  it("writes the clitic ه only at a clause end", () => {
    // Same word, two positions. The bare reading mid-phrase is the ezafe; the
    // ه reading at the end is the copula.
    expect(rules.transliterate("dare khune baaze").text).toBe("در خونه بازه");
    expect(rules.transliterate("baaze").text).toBe("بازه");
    expect(rules.transliterate("baaze dar").text).toBe("باز در");
  });

  it("treats punctuation as a clause end", () => {
    expect(rules.transliterate("havaa khoobe, vali sard ast").text.startsWith("هوا خوبه")).toBe(true);
  });

  it("leaves a word whose ه is part of it alone in both positions", () => {
    // The counterexample that stops the term becoming a rule: پنجره carries its
    // own ه and پنجر is in the candidate list to lose to, wherever it stands.
    expect(rules.transliterate("panjere shekast").text).toBe("پنجره شکست");
    expect(rules.transliterate("shekast panjere").text).toBe("شکست پنجره");
  });

  it("is a tilt, not a rule, in both directions", () => {
    // With the term off the engine writes the bare form even where the copula
    // is the only reading; with it turned up far enough it writes a ه wherever
    // one is on offer, and برایه — 3.1 nats behind برای — is what that costs.
    // The shipped value has to sit strictly between the two.
    const off = new RuleTransliterator({ ...shared, scoring: { finalHe: 0 } });
    const absurd = new RuleTransliterator({ ...shared, scoring: { finalHe: 8 } });
    expect(off.transliterate("panjere shekast").text).toBe("پنجره شکست");
    expect(off.transliterate("havaa khoobe").text).not.toBe("هوا خوبه");
    expect(absurd.transliterate("in kaar baraaye").text).toBe("این کار برایه");
    expect(rules.transliterate("in kaar baraaye").text).toBe("این کار برای");
    expect(SCORING.finalHe).toBeGreaterThan(0);
    expect(SCORING.finalHe).toBeLessThan(4);
  });

  it("keeps the detached ezafe cases it already handled", () => {
    // `detachedEzafe` runs before the sentence pass; the new term must not
    // disturb either the dropped `e` or the ی appended after ا.
    expect(rules.transliterate("ketaab e man inja ast").text).toBe("کتاب من اینجا است");
    expect(rules.transliterate("baraa ye to kharidam").text).toBe("برای تو خریدم");
    expect(rules.transliterate("khaane ye bozorg").text).toBe("خانه بزرگ");
  });
});

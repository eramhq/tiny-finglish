/**
 * Chat Finglish, asserted row by row.
 *
 * The chat round's engine fixes each target one failure you can name — a
 * table word the channel could not reach, a tie-break that undid a right
 * answer — so a corpus-wide threshold would hide exactly what broke. These are
 * the `chat` fixtures themselves on the engines that ship them, the four words
 * the v8 ship rule names on every tier, and the edges of each fix.
 *
 * Read with `data/chat/README.md`, `src/rules.ts` (`VARIANTS`) and
 * `Pipeline.sentencePass`.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RuleTransliterator, Transliterator } from "../src/index.ts";
import { loadFrequency, loadLexicon, loadModel, loadVowels } from "../scripts/_load.ts";

const root = new URL("..", import.meta.url);
const hasWeights = existsSync(new URL("data/fixtures/weights.json", root));

const fixtures = new Map<string, { input: string; expected: string }>(
  readFileSync(new URL("data/fixtures/fixtures.jsonl", root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; category: string; input: string; expected: string })
    .filter((row) => row.category === "chat")
    .map((row) => [row.id, { input: row.input, expected: row.expected }]),
);

const shared = {
  ...(loadLexicon() ? { lexicon: loadLexicon()! } : {}),
  ...(loadFrequency() ? { frequency: loadFrequency()! } : {}),
  ...(loadVowels() ? { vowels: loadVowels()! } : {}),
};
const rules = new RuleTransliterator(shared);
const model = hasWeights ? new Transliterator({ ...shared, model: loadModel()! }) : undefined;
const hybrid = hasWeights ? new Transliterator({ ...shared, model: loadModel()!, hybrid: true }) : undefined;

/**
 * The fixture rows each tier gets exactly. What is missing is documented, not
 * forgotten: اوکی and فدات are table words no channel path reaches from `okey`
 * and `fadat` (an initial `o` for او was tried and cost the hybrid 0.4 on dev),
 * and حله and خستم lose to commoner table words (حال, خسته).
 */
const EXACT = {
  rules: ["chat-001", "chat-004", "chat-005", "chat-006", "chat-007", "chat-008", "chat-010", "chat-011",
    "chat-012", "chat-015", "chat-016"],
  hybrid: ["chat-001", "chat-004", "chat-005", "chat-007", "chat-008", "chat-010", "chat-011", "chat-012",
    "chat-015", "chat-016"],
} as const;

/** The v8 ship rule: these pass on every tier or the weights do not ship. */
const SHIP_RULE = [["salam", "سلام"], ["merci", "مرسی"], ["kojaei", "کجایی"], ["ketabe", "کتابه"]] as const;

describe("chat fixtures", () => {
  it("has the chat fixtures to assert", () => {
    expect(fixtures.size).toBe(16);
  });

  for (const id of EXACT.rules) {
    it(`${id} on the rules tier`, () => {
      const row = fixtures.get(id)!;
      expect(rules.transliterate(row.input).text).toBe(row.expected);
    });
  }

  it.skipIf(!hybrid)("the hybrid tier's rows", () => {
    for (const id of EXACT.hybrid) {
      const row = fixtures.get(id)!;
      expect(hybrid!.transliterate(row.input).text, id).toBe(row.expected);
    }
  });
});

describe("the ship-rule words", () => {
  for (const [input, expected] of SHIP_RULE) {
    it(`${input} on the rules tier`, () => {
      expect(rules.transliterate(input).text).toBe(expected);
    });
  }

  it.skipIf(!hybrid)("on the hybrid tier", () => {
    for (const [input, expected] of SHIP_RULE) expect(hybrid!.transliterate(input).text, input).toBe(expected);
  });
});

describe("the fixes, and where each one stops", () => {
  it("reads a soft c as س, and only a soft one", () => {
    expect(rules.transliterate("merci").text).toBe("مرسی");
    expect(rules.transliterate("cinema").text).toBe("سینما");
    // `c` before a, o, u is still ک.
    expect(rules.transliterate("cafe").text).toBe("کافه");
  });

  it("reaches the hiatus ی of a final ایی", () => {
    expect(rules.transliterate("kojai").text).toBe("کجایی");
    expect(rules.transliterate("tanhaei").text).toBe("تنهایی");
    // The doubled ی is a unit the table must vouch for, not a default.
    expect(rules.transliterate("khoobi").text).toBe("خوبی");
    expect(rules.transliterate("chai").text).toBe("چای");
  });

  it.skipIf(!model)("writes بخاطر for bekhatere on every tier, now heBorrow is gone", () => {
    for (const engine of [rules, model!, hybrid!]) expect(engine.transliterate("bekhatere").text).toBe("بخاطر");
  });
});

describe("the chat sets", () => {
  /** Every chat number is AI-typed, and the rows say so. */
  for (const file of ["data/chat/chat-dev.jsonl", "data/chat/chat-test.jsonl"]) {
    it(`${file} is labelled AI-typed on every row`, () => {
      const rows = readFileSync(new URL(file, root), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.typedBy).toBe("llm");
        expect(row.category).toBe("chat");
        // The gold convention: no ZWNJ in the reference; ZWNJ spellings are alternatives.
        expect(row.expected).not.toContain("‌");
      }
    });
  }
});

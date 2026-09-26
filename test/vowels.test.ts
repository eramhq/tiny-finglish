/**
 * Vowel agreement: `salam` is سلام, on every tier.
 *
 * `salam` is the first word anyone types, and until this term it was guarded
 * only by three fixture words inside a corpus-wide threshold — which is how v7
 * came to write سالم for it in every context without failing a test. These
 * assert it directly, on the engines that ship, plus the two properties
 * `vowelPass` exists to keep: a word outside any confusable group is untouched,
 * and evidence against one spelling never lifts its groupmate over a third
 * word.
 *
 * Read with `src/vowels.ts` and `SCORING.vowelAgreement`.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Transliterator, RuleTransliterator } from "../src/index.ts";
import { encodeFrontCoded } from "../src/frontcode.ts";
import { decodeVowelTable, typedVowels, vowelMismatches, vowelPass } from "../src/vowels.ts";
import { loadFrequency, loadLexicon, loadModel, loadVowels } from "../scripts/_load.ts";
import type { Candidate } from "../src/types.ts";

const hasWeights = existsSync(new URL("../data/fixtures/weights.json", import.meta.url));
const vowels = loadVowels();

const data = {
  ...(loadLexicon() ? { lexicon: loadLexicon()! } : {}),
  ...(loadFrequency() ? { frequency: loadFrequency()! } : {}),
};
const shared = { ...data, ...(vowels ? { vowels } : {}) };
const tiers: Array<[string, RuleTransliterator | Transliterator | undefined]> = [
  ["rules", new RuleTransliterator(shared)],
  ["model", hasWeights ? new Transliterator({ ...shared, model: loadModel()!, hybrid: false }) : undefined],
  ["hybrid", hasWeights ? new Transliterator({ ...shared, model: loadModel()!, hybrid: true }) : undefined],
];

function encode(entries: Record<string, string>): Uint8Array {
  const words = Object.keys(entries).sort();
  const vowelBytes = words.flatMap((w) => [...entries[w]!].map((c) => c.charCodeAt(0)).concat(0x0a));
  return Uint8Array.from([...encodeFrontCoded(words), ...vowelBytes]);
}

describe("the vowel table", () => {
  it("round-trips through the codec", () => {
    const entries = { سلام: "aA", سالم: "Ae", سهم: "a", سهام: "aA" };
    const table = decodeVowelTable(encode(entries));
    expect(Object.fromEntries(table)).toEqual(entries);
  });

  it("refuses a truncated artifact", () => {
    const bytes = encode({ سلام: "aA", سالم: "Ae" });
    expect(() => decodeVowelTable(bytes.slice(0, -1))).toThrow(/truncated/);
  });

  it.skipIf(!vowels)("carries the words that motivated it", () => {
    expect(vowels!.get("سلام")).toBe("aA");
    expect(vowels!.get("سالم")).toBe("Ae");
    // HomoRich transcribes سهم with its ezafe, `sahme`; the builder strips it.
    expect(vowels!.get("سهم")).toBe("a");
  });
});

describe("typed vowels", () => {
  it("reads `a` as ا or a short vowel, and `aa` as ا only", () => {
    expect(typedVowels("salam")).toEqual(["Aa", "Aa"]);
    expect(typedVowels("saalem")).toEqual(["A", "e"]);
  });

  it("reads `y` as a vowel only between consonants", () => {
    expect(typedVowels("khyli")).toEqual(["i", "i"]);
    expect(typedVowels("yek")).toEqual(["e"]);
  });

  it("charges a contradicted vowel and an extra typed one, not a dropped one", () => {
    expect(vowelMismatches(typedVowels("salam"), "aA")).toBe(0);
    expect(vowelMismatches(typedVowels("salam"), "Ae")).toBe(1);
    expect(vowelMismatches(typedVowels("saham"), "a")).toBe(1);
    expect(vowelMismatches(typedVowels("salm"), "aA")).toBe(0);
  });
});

describe("vowelPass", () => {
  const table = decodeVowelTable(encode({ غلات: "aA", غلت: "e", سلام: "aA", سالم: "Ae" }));
  const list = (pairs: Array<[string, number]>): Candidate[] =>
    pairs.map(([output, probability]) => ({ output, probability, reason: "test" }));

  it("reorders a confusable pair by the vowels typed", () => {
    const out = vowelPass("salam", list([["سالم", 0.6], ["سلام", 0.4]]), table, 3);
    expect(out.map((c) => c.output)).toEqual(["سلام", "سالم"]);
  });

  it("never lifts a groupmate over a word outside the group", () => {
    // `ghalat`: غلات agrees and غلت does not, but غلط is in no group, so the
    // term has no evidence about it and must not move غلات past it.
    const out = vowelPass("ghalat", list([["غلط", 0.47], ["غلات", 0.45], ["غلت", 0.08]]), table, 3);
    expect(out.map((c) => c.output)).toEqual(["غلط", "غلات", "غلت"]);
  });

  it("returns a list with no group unchanged", () => {
    const input = list([["کتاب", 0.9], ["کتب", 0.1]]);
    expect(vowelPass("ketab", input, table, 3)).toEqual(input);
  });
});

describe.skipIf(!vowels)("on the shipped engines", () => {
  for (const [tier, engine] of tiers) {
    describe.skipIf(!engine)(tier, () => {
      it("writes `salam` as سلام, alone and in context", () => {
        expect(engine!.transliterate("salam").text).toBe("سلام");
        expect(engine!.transliterate("salam donya").text).toBe("سلام دنیا");
        expect(engine!.transliterate("man salam kardam").text).toBe("من سلام کردم");
      });

      it("still writes `saalem` as سالم", () => {
        expect(engine!.transliterate("saalem").text).toBe("سالم");
      });

      it("writes `saham` as سهام", () => {
        expect(engine!.transliterate("saham").text).toBe("سهام");
      });
    });
  }

  it("leaves a word outside any group exactly as it was", () => {
    const without = new RuleTransliterator(data);
    const withTable = tiers[0]![1]!;
    for (const word of ["khoob", "daneshgah", "emrooz", "mikonam"]) {
      expect(withTable.transliterate(word).spans).toEqual(without.transliterate(word).spans);
    }
  });
});

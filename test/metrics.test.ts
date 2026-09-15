/**
 * The evaluation metrics.
 *
 * Every accuracy figure this project publishes goes through `wordAccuracy`, and
 * the playground reproduces the CLI's numbers by calling the same function. A
 * silent change here would move every number in the README at once, so the
 * folds it applies — and the ones it deliberately does not — are pinned.
 */
import { describe, expect, it } from "vitest";
import { characterErrorRate, splitWords, wordAccuracy } from "../src/metrics.ts";

const ZWNJ = "‌";

describe("splitWords", () => {
  it("treats ZWNJ as a separator", () => {
    expect(splitWords(`می${ZWNJ}کنی`)).toEqual(["می", "کنی"]);
  });

  it("folds punctuation to a separator, not to nothing", () => {
    // Deleting the comma would fuse two words into one that matches neither.
    expect(splitWords("نه،میخام")).toEqual(["نه", "میخام"]);
    expect(splitWords("کردم، بعد")).toEqual(["کردم", "بعد"]);
  });

  it("covers Latin and Persian marks, quotes and dashes", () => {
    for (const mark of [".", ",", "!", "?", ";", ":", "(", ")", "[", "]", "{", "}",
                        "،", "؛", "؟", "«", "»", "—", "–", "…", '"', "'", "-"]) {
      expect(splitWords(`الف${mark}ب`)).toEqual(["الف", "ب"]);
    }
  });

  it("drops a token that was only punctuation", () => {
    expect(splitWords("سلام ، خوبی")).toEqual(["سلام", "خوبی"]);
  });

  it("keeps digits, which are word content and not punctuation", () => {
    expect(splitWords("۱۲۳ تا")).toEqual(["۱۲۳", "تا"]);
    expect(splitWords("سال 1400")).toEqual(["سال", "1400"]);
  });
});

describe("wordAccuracy", () => {
  it("scores a glued reference against an unglued hypothesis as correct", () => {
    // The gold's Persian side glues marks to words; we emit punctuation as its
    // own span. Both spell the same two words.
    expect(wordAccuracy("کردم، رفتم", "کردم ، رفتم")).toEqual({ correct: 2, total: 2 });
    expect(wordAccuracy("میکند.", "میکند")).toEqual({ correct: 1, total: 1 });
  });

  it("does not let the fold mask a genuinely wrong word", () => {
    expect(wordAccuracy("کردم، رفتم", "کردم ، گفتم")).toEqual({ correct: 1, total: 2 });
  });

  it("charges one error for a spurious word, not one per word after it", () => {
    // The insertion itself costs 1. Comparing position by position would have
    // scored this 1/3, marking every later word wrong because of one shift.
    expect(wordAccuracy("الف ب ج", "الف خ ب ج")).toEqual({ correct: 2, total: 3 });
  });

  it("never reports more errors than the reference has words", () => {
    expect(wordAccuracy("الف", "ب ج د ه و")).toEqual({ correct: 0, total: 1 });
  });

  it("folds ZWNJ on both sides", () => {
    expect(wordAccuracy(`می${ZWNJ}کنی`, "می کنی")).toEqual({ correct: 2, total: 2 });
  });
});

describe("characterErrorRate", () => {
  it("is not punctuation-folded — a character metric counts every character", () => {
    // Deliberately different from wordAccuracy. `scripts/split-gold.ts` folds
    // first, explicitly, when it wants the word metric's view.
    expect(characterErrorRate("میکند.", "میکند")).toBeCloseTo(1 / 6, 6);
  });

  it("is 0 for an exact match and 1 against an empty hypothesis", () => {
    expect(characterErrorRate("سلام", "سلام")).toBe(0);
    expect(characterErrorRate("سلام", "")).toBe(1);
  });
});

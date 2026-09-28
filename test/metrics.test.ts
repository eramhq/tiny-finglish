/**
 * The evaluation metrics.
 *
 * Every accuracy figure this project publishes goes through `wordAccuracy`, and
 * the playground reproduces the CLI's numbers by calling the same function. A
 * silent change here would move every number in the README at once, so the
 * folds it applies — and the ones it deliberately does not — are pinned.
 */
import { describe, expect, it } from "vitest";
import {
  characterErrorRate,
  lenientSplitWords,
  orthographicWordAccuracy,
  splitWords,
  wordAccuracy,
  wordMismatches,
} from "../src/metrics.ts";

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

  it("folds a chat stretch of three or more letters to one", () => {
    expect(splitWords("مرسیییی عزیزم")).toEqual(["مرسی", "عزیزم"]);
    expect(splitWords("هممم")).toEqual(["هم"]);
    expect(wordAccuracy("مرسی", "مرسیییی")).toEqual({ correct: 1, total: 1 });
    // A doubled letter is a spelling, and digits are not letters.
    expect(splitWords("کجایی")).toEqual(["کجایی"]);
    expect(splitWords("۱۰۰۰")).toEqual(["۱۰۰۰"]);
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

describe("lenientSplitWords", () => {
  it("joins verbal prefixes however they were separated", () => {
    expect(lenientSplitWords(`می${ZWNJ}کنم`)).toEqual(["میکنم"]);
    expect(lenientSplitWords("نمی دانم")).toEqual(["نمیدانم"]);
    expect(lenientSplitWords("میکنم")).toEqual(["میکنم"]);
  });

  it("joins plural and personal suffixes onto the word before", () => {
    expect(lenientSplitWords("کتاب ها را")).toEqual(["کتابها", "را"]);
    expect(lenientSplitWords("رفته اند")).toEqual(["رفتهاند"]);
    expect(lenientSplitWords("بزرگ ترین")).toEqual(["بزرگترین"]);
  });

  it("folds آ and digit scripts, and nothing that changes the word", () => {
    expect(lenientSplitWords("آن ۲۵")).toEqual(["ان", "25"]);
    // ع, long vowels and homophone letters are real spelling errors.
    expect(lenientSplitWords("عالی سد")).toEqual(["عالی", "سد"]);
  });

  it("scores spacing variants as the same words", () => {
    expect(wordAccuracy("میکنم کتابها", `می${ZWNJ}کنم کتاب ها`, lenientSplitWords))
      .toEqual({ correct: 2, total: 2 });
    expect(wordAccuracy("میکنم کتابها", `می${ZWNJ}کنم کتاب ها`)).toEqual({ correct: 0, total: 2 });
  });

  it("never leaves a prefix or suffix dangling at a boundary", () => {
    expect(lenientSplitWords("ها می")).toEqual(["ها", "می"]);
  });
});

describe("wordMismatches", () => {
  const costOf = (r: string, h: string) =>
    wordMismatches(r.split(" "), h.split(" ")).reduce((sum, s) => sum + s.cost, 0);

  it("returns the runs the distance charged, and their costs sum to it", () => {
    const spans = wordMismatches("الف ب ج د".split(" "), "الف خ ج ذ ر".split(" "));
    expect(spans).toEqual([
      { refStart: 1, refEnd: 2, hypStart: 1, hypEnd: 2, cost: 1 },
      { refStart: 3, refEnd: 4, hypStart: 3, hypEnd: 5, cost: 2 },
    ]);
    for (const [r, h] of [["الف ب ج", "الف خ ب ج"], ["الف", "ب ج د"], ["الف ب", "الف ب"]] as const) {
      const { correct, total } = wordAccuracy(r, h);
      expect(Math.min(costOf(r, h), total)).toBe(total - correct);
    }
  });

  it("represents a pure deletion or insertion as an empty side", () => {
    expect(wordMismatches(["الف", "ب"], ["الف"])).toEqual([
      { refStart: 1, refEnd: 2, hypStart: 1, hypEnd: 1, cost: 1 },
    ]);
    expect(wordMismatches(["الف"], ["خ", "الف"])).toEqual([
      { refStart: 0, refEnd: 0, hypStart: 0, hypEnd: 1, cost: 1 },
    ]);
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

describe("orthographicWordAccuracy", () => {
  it("forgives compound spacing in either direction", () => {
    expect(orthographicWordAccuracy("زمانیکه رفتم", "زمانی که رفتم")).toEqual({ correct: 2, total: 2 });
    expect(orthographicWordAccuracy("زمانی که رفتم", "زمانیکه رفتم")).toEqual({ correct: 3, total: 3 });
    expect(orthographicWordAccuracy("راهحلهای خوب", `راه${ZWNJ}حل${ZWNJ}های خوب`)).toEqual({ correct: 2, total: 2 });
  });

  it("still charges a real mistake next to a spacing difference", () => {
    expect(orthographicWordAccuracy("زمانیکه رفتم", "زمانی که رفت")).toEqual({ correct: 1, total: 2 });
  });

  it("forgives the ه of a leading به or چه written solid, either way", () => {
    expect(orthographicWordAccuracy("بدست آورد", "به دست آورد")).toEqual({ correct: 2, total: 2 });
    expect(orthographicWordAccuracy("چه قدر", "چقدر")).toEqual({ correct: 2, total: 2 });
    expect(orthographicWordAccuracy("بعنوان مثال", "به عنوان مثال")).toEqual({ correct: 2, total: 2 });
  });

  it("never matches other different letters", () => {
    expect(orthographicWordAccuracy("زمانیکه", "زمان که")).toEqual({ correct: 0, total: 1 });
    // Only a leading به or چه may lose its ه, and the plain join still counts.
    expect(orthographicWordAccuracy("بهار", "به ار")).toEqual({ correct: 1, total: 1 });
    expect(orthographicWordAccuracy("بار", "به ار")).toEqual({ correct: 1, total: 1 });
    expect(orthographicWordAccuracy("خانهدار", "خان دار")).toEqual({ correct: 0, total: 1 });
    expect(orthographicWordAccuracy("ب", "به")).toEqual({ correct: 0, total: 1 });
  });

  it("keeps the folds of the orthographic split", () => {
    expect(orthographicWordAccuracy("میکنم", `می${ZWNJ}کنم`)).toEqual({ correct: 1, total: 1 });
    expect(orthographicWordAccuracy("آن", "ان")).toEqual({ correct: 1, total: 1 });
  });
});

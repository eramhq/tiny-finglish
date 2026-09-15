/**
 * The dictionary candidate generator and the noisy channel.
 *
 * The examples here are deliberately *not* the gold failures that motivated
 * the module (نظر, عذر, سوال, سعید): gold phenomena get different fixtures.
 */
import { describe, expect, it } from "vitest";
import { Channel, latinSkeleton, persianSkeleton, SkeletonIndex } from "../src/dictionary.ts";
import { compose, decompose } from "../src/morph.ts";

const ZWNJ = "‌";

describe("skeleton keys", () => {
  it("drops vowels and vowel letters on both sides", () => {
    expect(persianSkeleton("کتاب")).toBe("کتب");
    expect(latinSkeleton("ketaab")).toBe("کتب");
    expect(latinSkeleton("ketab")).toBe("کتب");
  });

  it("folds homophone classes so the rare letter lands in the common bucket", () => {
    expect(persianSkeleton("صبر")).toBe(latinSkeleton("sabr"));
    expect(persianSkeleton("ضعیف")).toBe(latinSkeleton("zaeef"));
    expect(persianSkeleton("طلا")).toBe(latinSkeleton("talaa"));
    expect(persianSkeleton("غذا")).toBe(latinSkeleton("ghazaa"));
  });

  it("reads digraphs and English-keyboard letters", () => {
    expect(latinSkeleton("khosh")).toBe("خش");
    expect(latinSkeleton("xosh")).toBe("خش");
    expect(latinSkeleton("qand")).toBe(persianSkeleton("قند"));
  });

  it("drops the silent و of خوا, so both spellings share a key", () => {
    expect(persianSkeleton("خواب")).toBe(latinSkeleton("khaab"));
  });

  it("drops a final ه or h, which is as often a silent he as a consonant", () => {
    expect(persianSkeleton("مدرسه")).toBe(latinSkeleton("madrese"));
    expect(persianSkeleton("مدرسه")).toBe(latinSkeleton("madreseh"));
  });

  it("collapses doubles, since Persian does not write gemination", () => {
    expect(latinSkeleton("ammaa")).toBe(persianSkeleton("اما"));
  });

  it("refuses a Persian word carrying punctuation or digits", () => {
    expect(persianSkeleton("است،")).toBeNull();
  });
});

describe("SkeletonIndex", () => {
  const table = new Map([
    ["صبر", 0.4], ["سبر", 0.1], ["صابر", 0.3], [`می${ZWNJ}روم`, 0.5], ["میروم", 0.2],
  ]);
  const index = new SkeletonIndex(table);

  it("returns every table word with the input's skeleton, most frequent first", () => {
    expect(index.lookup("sabr", 10)).toEqual(["صبر", "صابر", "سبر"]);
    expect(index.lookup("sabr", 1)).toEqual(["صبر"]);
  });

  it("indexes ZWNJ words in their solid form, keeping the higher frequency", () => {
    expect(index.lookup("miravam", 10)).toEqual(["میروم"]);
    expect(index.frequency.get("میروم")).toBe(0.5);
  });
});

describe("Channel", () => {
  const channel = new Channel({ insertion: 0.5, gemination: Math.log(0.3) });

  it("does not charge a rare homophone letter — rarity is frequency's job", () => {
    expect(channel.score("sabr", "صبر")).toBeCloseTo(channel.score("sabr", "سبر"), 9);
    expect(channel.score("zamin", "ضمین")).toBeCloseTo(channel.score("zamin", "زمین"), 9);
  });

  it("is -Infinity when no alignment exists", () => {
    expect(channel.score("sabr", "کتاب")).toBe(-Infinity);
  });

  it("prefers the measured spelling of a letter to a rare one", () => {
    // `kh` is 99.9% of خ in real typing, `x` 0.1%.
    expect(channel.score("khosh", "خوش")).toBeGreaterThan(channel.score("xosh", "خوش"));
  });

  it("aligns a doubled consonant against a single letter, at a cost", () => {
    const single = channel.score("amaa", "اما");
    const doubled = channel.score("ammaa", "اما");
    expect(doubled).toBeGreaterThan(-Infinity);
    expect(doubled).toBeLessThan(single);
  });

  it("reaches the silent و of خوا through the decoder-only variant", () => {
    expect(channel.score("khaab", "خواب")).toBeGreaterThan(-Infinity);
  });
});

describe("morphology", () => {
  it("peels clitics, plurals and prefixes, innermost suffix first", () => {
    const splits = decompose("ketaabhaamoon").map((d) => `${d.prefix?.latin ?? ""}|${d.stem}|${d.suffixes.map((s) => s.latin).join(",")}`);
    expect(splits).toContain("|ketaab|haa,moon");
    expect(decompose("nemikhoram").map((d) => `${d.prefix?.latin}|${d.stem}`)).toContain("nemi|khoram");
  });

  it("never proposes a stem shorter than three letters", () => {
    expect(decompose("nam").length).toBe(0);
  });

  it("writes clitics after a silent he with an alef, and ی after a vowel as یی", () => {
    const esh = { latin: "esh", fa: "ش" };
    expect(compose(undefined, "قلم", [esh])).toBe("قلمش");
    expect(compose(undefined, "مدرسه", [esh])).toBe("مدرسهاش");
    expect(compose(undefined, "جا", [{ latin: "i", fa: "ی" }])).toBe("جایی");
    expect(compose({ latin: "mi", fa: "می" }, "خورم", [])).toBe("میخورم");
  });
});

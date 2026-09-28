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
import { wordAccuracy } from "../src/metrics.ts";

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
const model = hasWeights ? new Transliterator({ ...shared, model: loadModel()!, hybrid: false }) : undefined;
const hybrid = hasWeights ? new Transliterator({ ...shared, model: loadModel()!, hybrid: true }) : undefined;

/**
 * The fixture rows each tier gets exactly. What is missing is documented, not
 * forgotten: اوکی and فدات are table words no channel path reaches from `okey`
 * and `fadat` (an initial `o` for او was tried and cost the hybrid 0.4 on dev),
 * and حله and خستم lose to commoner table words (حال, خسته). `ok bashe`
 * (chat-014) passes since the loanword table, which has `ok`. On the model
 * tier `bashee` is باشی: a run of two is not a stretch, so it reaches the model
 * as typed. The model tier misses chat-030 (`ketabo`, see the object-marker
 * tests) and writes نیمدی for `nayomadi` in chat-032.
 */
const EXACT = {
  rules: ["chat-001", "chat-004", "chat-005", "chat-006", "chat-007", "chat-008", "chat-010", "chat-011",
    "chat-012", "chat-014", "chat-015", "chat-016", ...range(17, 33)],
  hybrid: ["chat-001", "chat-004", "chat-005", "chat-007", "chat-008", "chat-010", "chat-011", "chat-012",
    "chat-014", "chat-015", "chat-016", "chat-006", ...range(17, 33)],
  model: ["chat-001", "chat-002", "chat-005", "chat-006", "chat-007", "chat-008", "chat-010", "chat-011",
    "chat-012", "chat-013", "chat-014", "chat-016", "chat-017", ...range(19, 29), "chat-031", "chat-033"],
} as const;

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => `chat-${String(from + i).padStart(3, "0")}`);
}

/**
 * The v8 ship rule: these pass on every tier. `ketabe` was part of it and
 * v8 ships without it on the model tier, by decision: see the last test.
 */
const SHIP_RULE = [["salam", "سلام"], ["merci", "مرسی"], ["kojaei", "کجایی"], ["ketabe", "کتابه"]] as const;

describe("chat fixtures", () => {
  it("has the chat fixtures to assert", () => {
    expect(fixtures.size).toBe(33);
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

  it.skipIf(!model)("the model tier's rows", () => {
    for (const id of EXACT.model) {
      const row = fixtures.get(id)!;
      expect(model!.transliterate(row.input).text, id).toBe(row.expected);
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

  it.skipIf(!model)("on the model tier, all but ketabe", () => {
    for (const [input, expected] of SHIP_RULE.slice(0, 3)) {
      expect(model!.transliterate(input).text, input).toBe(expected);
    }
  });

  /**
   * The exception v8 shipped with. The model prefers the ezafe reading of
   * `ketabe` (`ketabe man`) 81/19 even after the clause-final tilt; a round of
   * 489 copula lines moved that to 60/40 and started writing دانشجوهه, so it
   * was not shipped either. Pinned where it misses: flip it when a model
   * writes کتابه here.
   */
  it.skipIf(!model)("ketabe is still the bare noun on the model tier", () => {
    expect(model!.transliterate("ketabe").text).toBe("کتاب");
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

describe("stretched words", () => {
  const engines = () => [rules, ...(model ? [model, hybrid!] : [])];

  it("converts the word without its stretch and writes the stretch back", () => {
    for (const engine of engines()) {
      expect(engine.transliterate("merciiii").text).toBe("مرسیییی");
      expect(engine.transliterate("hmmm").text).toBe("هممم");
      // Every candidate that ends on a vowel letter gets it, not just the first.
      for (const { output } of engine.transliterate("merciiii").spans[0]!.candidates!) {
        if (/[اویه]$/u.test(output)) expect(output, output).toMatch(/(.)\1\1\1$/u);
      }
    }
  });

  it("caps the written-back stretch at six letters", () => {
    expect(rules.transliterate("merciiiiiiiiii").text).toBe(`مرس${"ی".repeat(6)}`);
  });

  it("only collapses when the letters disagree, or the stretch is medial", () => {
    for (const engine of engines()) {
      // A consonant run on the ی of اوکی.
      expect(engine.transliterate("okkk").text).toBe("اوکی");
      expect(engine.transliterate("salaaaam").text).toBe("سلام");
    }
  });

  it("scores a stretched word as the word", () => {
    expect(wordAccuracy("مرسی مامان", rules.transliterate("merciii maman").text)).toEqual({ correct: 2, total: 2 });
  });
});

describe("loanwords", () => {
  const engines = () => [rules, ...(model ? [model, hybrid!] : [])];

  it("writes the table's Persian on every tier", () => {
    for (const engine of engines()) {
      for (const [input, expected] of [["backup", "بکاپ"], ["cake", "کیک"], ["pizza", "پیتزا"], ["email", "ایمیل"],
        ["message", "مسیج"], ["instagram", "اینستاگرام"]] as const) {
        expect(engine.transliterate(input).text, input).toBe(expected);
      }
    }
  });

  it("reads Persian endings on a table stem, written solid", () => {
    for (const [input, expected] of [["laptopam", "لپتاپم"], ["postamo", "پستمو"], ["storyasho", "استوریاشو"],
      ["linketo", "لینکتو"], ["oki", "اوکی"]] as const) {
      expect(rules.transliterate(input).text, input).toBe(expected);
    }
  });

  it("lets position choose the final e: ezafe mid-phrase, copula at the end", () => {
    for (const engine of engines()) {
      expect(engine.transliterate("laptope man").text).toBe("لپتاپ من");
      expect(engine.transliterate("laptope").text).toBe("لپتاپه");
    }
  });

  it("keeps the detached ending as typed (mixed-004)", () => {
    for (const engine of engines()) expect(engine.transliterate("email et ro befrest").text).toBe("ایمیل ات رو بفرست");
  });

  it("stays English among English words", () => {
    expect(rules.transliterate("google chrome").text).toBe("google chrome");
    expect(rules.transliterate("tu google bezan").text).toBe("تو گوگل بزن");
  });

  it("leaves Finglish homographs alone", () => {
    expect(rules.transliterate("bad").text).toBe(rules.transliterate("bad", { forceConvert: ["bad"] }).text);
    expect(rules.transliterate("name").text).toBe("نامه");
    expect(rules.transliterate("mast").text).toBe("ماست");
  });

  it("still lets protect and forceConvert win", () => {
    expect(rules.transliterate("pizza", { protect: ["pizza"] }).text).toBe("pizza");
    expect(rules.transliterate("google chrome", { forceConvert: ["google"] }).text).toBe("گوگل chrome");
  });
});

describe("the object marker on native words", () => {
  it("writes the o the engines used to drop, with a possessive before it", () => {
    for (const engine of [rules, ...(hybrid ? [hybrid] : [])]) {
      for (const [input, expected] of [["dishabo", "دیشبو"], ["tavalodesho", "تولدشو"], ["pulamo", "پولمو"],
        ["namato", "نامتو"], ["gushimo", "گوشیمو"]] as const) {
        expect(engine.transliterate(input).text, input).toBe(expected);
      }
    }
  });

  it("leaves words that end in o, and a final ع, alone", () => {
    for (const [input, expected] of [["boro", "برو"], ["khodro", "خودرو"], ["radio", "رادیو"], ["tanavo", "تنوع"]] as const) {
      expect(rules.transliterate(input).text, input).toBe(expected);
    }
  });

  it("needs the frequency table", () => {
    expect(new RuleTransliterator().transliterate("dishabo").spans[0]!.candidates![0]!.reason).not.toMatch(/object/);
  });

  /**
   * The model tier ranks کتابو first itself, and the lexicon tie-break swaps
   * it for the attested کتاب (0.48 against 0.37, inside its 0.25 margin). The
   * marker only steps in when the best candidate lacks the و, so it does not
   * reach this. Pinned where it misses.
   */
  it.skipIf(!model)("ketabo is still the bare noun on the model tier", () => {
    expect(model!.transliterate("ketabo").text).toBe("کتاب");
  });
});

describe("the loanword guard's evidence", () => {
  it("clears a loanword typists never spell the colliding word as", () => {
    // سری is typed seri/sari 92 times in the LLM-typed corpus, never sorry.
    for (const [input, expected] of [["sorry", "سوری"], ["team", "تیم"], ["delete", "دیلیت"], ["pass", "پاس"]] as const) {
      expect(rules.transliterate(input).text, input).toBe(expected);
    }
  });

  it("drops one they do, and one with too little evidence", () => {
    // فک is typed `fake` 10 times in 42; فیل only twice in all.
    expect(rules.transliterate("fake").text).toBe("فک");
    expect(rules.transliterate("file").text).toBe("file");
  });
});

describe("texting abbreviations", () => {
  it("writes a reviewed skeleton as its word, on every tier", () => {
    for (const engine of [rules, ...(model ? [model, hybrid!] : [])]) {
      for (const [input, expected] of [["mrc", "مرسی"], ["slm", "سلام"], ["nmdnm", "نمیدونم"]] as const) {
        expect(engine.transliterate(input).text, input).toBe(expected);
      }
    }
  });

  it("matches exactly: no endings on a skeleton", () => {
    // `khdm` is خودم; `khdmo` is not خودمو from the table, it is whatever the engine reads.
    expect(rules.transliterate("khdmo").spans[0]!.candidates![0]!.reason).not.toBe("loanword");
  });

  it("does not translate English abbreviations", () => {
    for (const input of ["idk", "btw", "thx"]) {
      expect(rules.transliterate(input).spans[0]!.candidates?.[0]?.reason, input).not.toBe("loanword");
    }
  });

  it("leaves ok to the loanword table", () => {
    expect(rules.transliterate("ok").text).toBe("اوکی");
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

/**
 * `na` is نه, "no", on every tier. The rules read a final `a` as ا and wrote
 * نا for all 14 on dev and chat-dev until `WORD_EXCEPTIONS` in
 * `src/pipeline.ts`; the model already wrote نه.
 */
describe("na", () => {
  const tiers = [["rules", rules], ["model", model], ["hybrid", hybrid]] as const;
  for (const [name, engine] of tiers) {
    it.skipIf(!engine)(`is نه on the ${name} tier, alone, mid-sentence and before punctuation`, () => {
      expect(engine!.transliterate("na").text).toBe("نه");
      expect(engine!.transliterate("na mikham").text.split(" ")[0]).toBe("نه");
      expect(engine!.transliterate("na, bebakhshid").text.startsWith("نه،")).toBe(true);
    });
  }
  it("leaves words that only contain it alone", () => {
    expect(rules.transliterate("naameh").text).toBe("نامه");
  });
});

/**
 * The other `WORD_EXCEPTIONS` entry, and the stretch: a stretched exception
 * word is found before `unstretch` collapses it, and an unstretched `naa` is
 * still the prefix نا.
 */
describe("word exceptions, stretched and not", () => {
  const tiers = [["rules", rules], ["model", model], ["hybrid", hybrid]] as const;
  for (const [name, engine] of tiers) {
    it.skipIf(!engine)(`on the ${name} tier`, () => {
      expect(engine!.transliterate("naaa").text).toBe("نههه");
      expect(engine!.transliterate("naa omidi").text.startsWith("نا ")).toBe(true);
      expect(engine!.transliterate("hafte baad").text).toBe("هفته بعد");
    });
  }
});

/**
 * Three glued endings the rules lost: the conjunction on a number
 * (`numberConjunction`), the plural before the object marker
 * (`pluralObjectMarker`), and the copula ه at a clause end
 * (`copulaCandidate`) — with the look-alikes each one must leave alone.
 */
describe("glued و on numbers, plural + ro, clause-final copula", () => {
  const tiers = [["rules", rules], ["model", model], ["hybrid", hybrid]] as const;
  for (const [name, engine] of tiers) {
    it.skipIf(!engine)(`numbers on the ${name} tier`, () => {
      expect(engine!.transliterate("bisto panj").text).toBe("بیست و پنج");
      expect(engine!.transliterate("do hezaro yek").text).toBe("دو هزار و یک");
      expect(engine!.transliterate("yeko nim").text).toBe("یک و نیم");
      expect(engine!.transliterate("bisto 5").text).toBe("بیست و 5");
      // Without a number after it the o is the object marker: "give me the one".
      expect(engine!.transliterate("yeko bede").text).toBe("یکو بده");
    });
    it.skipIf(!engine)(`plural + ro on the ${name} tier`, () => {
      expect(engine!.transliterate("chizaro").text).toBe("چیزارو");
      expect(engine!.transliterate("inaro").text).toBe("اینارو");
      expect(engine!.transliterate("ketabharo").text).toBe("کتابهارو");
      // A noun in -ar with the object marker, not a plural.
      expect(engine!.transliterate("pesaro").text).toBe("پسرو");
      expect(engine!.transliterate("khabaro").text).toBe("خبرو");
      expect(engine!.transliterate("dokhtaro").text).toBe("دخترو");
    });
  }
  for (const [name, engine] of [["rules", rules], ["hybrid", hybrid]] as const) {
    it.skipIf(!engine)(`the copula ه at a clause end on the ${name} tier`, () => {
      expect(engine!.transliterate("ersal raygane?").text).toBe("ارسال رایگانه؟");
      expect(engine!.transliterate("ghazaye self eftezahe").text).toBe("غذای سلف افتضاحه");
      // Mid-sentence the bare word stays, and an ezafe head never takes it.
      expect(engine!.transliterate("kheyli raygane in").text).toBe("خیلی رایگان این");
      expect(engine!.transliterate("bekhatere").text).toBe("بخاطر");
    });
  }
});

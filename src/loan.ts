/**
 * Loanwords typed the English way — `backup`, `cake`, `laptopam`.
 *
 * A Persian texter who knows the English spelling of a loanword often types
 * it, and means the Persian word: بکاپ, کیک, لپتاپم. Read letter by letter
 * those come out as بککوپ and کاک, and `ENGLISH_WORDS` copies `pizza` and
 * `email` as English. The table in `loanwords.ts` is the fix: an English
 * spelling there is converted, and converted to the table's Persian.
 *
 * **Persian endings on a table stem** are read too, because that is where a
 * table stops being enough: `laptopam` -> لپتاپم, `storyasho` -> استوریاشو,
 * `linketo` -> لینکتو. A stem takes up to three endings, in order: plural
 * (`a`/`ha`), possessive (`am`/`et`/`esh`/`emun`…, or `m`/`t`/`sh`/`mun`… after
 * a vowel), and a final `o` (object marker), `i` or `e`. A final `e` is either
 * the ezafe (`laptope man`, لپتاپ) or the copula (`laptope`, لپتاپه), so it
 * gives both, bare first, and `Pipeline.finalHePass` chooses by position. A
 * stem's silent `e` may be dropped before an ending (`filam`, فایلم).
 * Everything is written solid, the gold convention.
 *
 * Endings are only tried on a stem that is in the table, and the fewest
 * endings win (`laptopam` is لپتاپم, not لپتاپام).
 *
 * **Texting abbreviations** (`mrc` مرسی, `bgo` بگو) are a second table in the
 * same module, built and guarded the same way, and matched exactly.
 */

import { ABBREVIATIONS, LOANWORDS } from "./loanwords.ts";

let table: Map<string, string> | undefined;
let abbreviations: Map<string, string> | undefined;

function parse(pairs: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of pairs.split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0) out.set(line.slice(0, space), line.slice(space + 1));
  }
  return out;
}

function loanTable(): Map<string, string> {
  return (table ??= parse(LOANWORDS));
}

const PLURAL: Readonly<Record<string, string>> = { a: "ا", ha: "ها" };

/**
 * Possessive endings after a consonant, then after a vowel, to their Persian.
 * Shared with `Pipeline.objectMarker`, which reads the same endings on native
 * words.
 */
export const POSSESSIVE_AFTER_CONSONANT: Readonly<Record<string, string>> = {
  am: "م", at: "ت", et: "ت", ash: "ش", esh: "ش",
  amun: "مون", emun: "مون", atun: "تون", etun: "تون", ashun: "شون", eshun: "شون",
  amoon: "مون", emoon: "مون", atoon: "تون", etoon: "تون", ashoon: "شون", eshoon: "شون",
};
export const POSSESSIVE_AFTER_VOWEL: Readonly<Record<string, string>> = {
  m: "م", t: "ت", sh: "ش", mun: "مون", tun: "تون", shun: "شون", moon: "مون", toon: "تون", shoon: "شون",
};

const VOWEL_FINAL = /[اویه]$/u;

/** A table word, bare or with Persian endings. */
export function isLoanword(word: string): boolean {
  return loanwordSpellings(word) !== undefined;
}

/**
 * The Persian spellings of a lowercase word the table covers, best first, or
 * `undefined` when it is not a table word with or without endings.
 */
export function loanwordSpellings(word: string): string[] | undefined {
  // Texting abbreviations (`mrc` مرسی) match exactly and take no endings: a
  // skeleton plus an ending is too often an ordinary word.
  const abbreviation = (abbreviations ??= parse(ABBREVIATIONS)).get(word);
  if (abbreviation) return [abbreviation];
  const words = loanTable();
  const bare = words.get(word);
  if (bare) return [bare];
  for (let cut = word.length - 1; cut >= 2; cut--) {
    const typed = word.slice(0, cut);
    const rest = word.slice(cut);
    const stem = words.get(typed) ?? (typed.endsWith("e") ? undefined : words.get(`${typed}e`));
    if (!stem) continue;
    const spelled = withEndings(stem, rest);
    if (spelled) return spelled;
  }
  return undefined;
}

/** `stem` plus the endings `rest` spells, or `undefined` when it spells none. */
function withEndings(stem: string, rest: string): string[] | undefined {
  let best: { parts: number; out: string[] } | undefined;
  const consider = (parts: number, out: string[]) => {
    if (!best || parts < best.parts) best = { parts, out };
  };

  const plurals: Array<[string, string]> = [["", ""], ...Object.entries(PLURAL)];
  for (const [pluralTyped, pluralFa] of plurals) {
    if (!rest.startsWith(pluralTyped)) continue;
    const afterPlural = stem + pluralFa;
    const possessives = VOWEL_FINAL.test(afterPlural) ? POSSESSIVE_AFTER_VOWEL : POSSESSIVE_AFTER_CONSONANT;
    const endings: Array<[string, string]> = [["", ""], ...Object.entries(possessives)];
    for (const [possTyped, possFa] of endings) {
      if (!rest.startsWith(possTyped, pluralTyped.length)) continue;
      const tail = rest.slice(pluralTyped.length + possTyped.length);
      const body = afterPlural + possFa;
      const parts = (pluralTyped ? 1 : 0) + (possTyped ? 1 : 0) + (tail ? 1 : 0);
      if (parts === 0) continue;
      if (tail === "") consider(parts, [body]);
      else if (tail === "o") consider(parts, [`${body}و`]);
      // After ی the typed `i` is that ی, not an ending: `oki` is اوکی.
      else if (tail === "i") consider(parts, [body + (/[او]$/u.test(body) ? "یی" : /ی$/u.test(body) ? "" : /ه$/u.test(body) ? "ای" : "ی")]);
      else if (tail === "e") consider(parts, [body, `${body}ه`]);
    }
  }
  return best?.out;
}

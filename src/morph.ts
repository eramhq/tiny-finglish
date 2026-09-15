/**
 * Finglish affix stripping — so an inflected word can borrow its stem's
 * dictionary entry.
 *
 * The 25k frequency table counts surface forms. Persian stacks prefixes and
 * clitics freely — `ketaabhaamoon`, `nemikhoramesh`, `ghalamesh` — so most
 * inflected forms are not in it, and the dictionary in `dictionary.ts` cannot
 * propose what the table does not hold. Here the *Latin* is split instead:
 * `ghalam·esh` looks `ghalam` up, finds قلم, and composes قلمش.
 *
 * **Why split the Latin and not back off on the Persian.** `src/frequency.ts`
 * records that scoring `کتابش` at a discounted `کتاب` lost accuracy at every
 * discount: a Persian suffix list matches far more than suffixes, because م, ت,
 * ش and ی end ordinary words too. A Latin split is much more specific — `esh`
 * after a consonant-final stem is almost always the clitic — and the composed
 * candidate still has to win on its channel score against every whole-word
 * candidate, paying a per-affix cost tuned on dev.
 */

export interface Affix {
  latin: string;
  fa: string;
}

/** Verbal prefixes. `be`/`bo`/`bi` are the subjunctive ب, `na`/`ne` negation. */
export const PREFIXES: readonly Affix[] = [
  { latin: "nemi", fa: "نمی" },
  { latin: "mi", fa: "می" },
  { latin: "be", fa: "ب" },
  { latin: "bo", fa: "ب" },
  { latin: "na", fa: "ن" },
  { latin: "ne", fa: "ن" },
];

/**
 * Suffixes, outermost first when stacked: `ketaab·haa·moon·o`. Each Latin
 * spelling maps to its written form after a consonant-final stem; `compose`
 * adjusts after a vowel.
 */
export const SUFFIXES: readonly Affix[] = [
  // Object marker.
  { latin: "ro", fa: "رو" },
  { latin: "roo", fa: "رو" },
  { latin: "raa", fa: "را" },
  { latin: "ra", fa: "را" },
  { latin: "o", fa: "و" },
  // Plural.
  { latin: "haa", fa: "ها" },
  { latin: "ha", fa: "ها" },
  // Personal clitics, singular and plural, formal and spoken.
  { latin: "am", fa: "م" },
  { latin: "at", fa: "ت" },
  { latin: "et", fa: "ت" },
  { latin: "ash", fa: "ش" },
  { latin: "esh", fa: "ش" },
  { latin: "emoon", fa: "مون" },
  { latin: "emun", fa: "مون" },
  { latin: "amoon", fa: "مون" },
  { latin: "emaan", fa: "مان" },
  { latin: "eman", fa: "مان" },
  { latin: "etoon", fa: "تون" },
  { latin: "etun", fa: "تون" },
  { latin: "etaan", fa: "تان" },
  { latin: "etan", fa: "تان" },
  { latin: "eshoon", fa: "شون" },
  { latin: "eshun", fa: "شون" },
  { latin: "eshaan", fa: "شان" },
  { latin: "eshan", fa: "شان" },
  { latin: "moon", fa: "مون" },
  { latin: "toon", fa: "تون" },
  { latin: "shoon", fa: "شون" },
  // Indefinite / relative ی.
  { latin: "i", fa: "ی" },
  // The ezafe, written only after ا or و; `compose` drops it elsewhere.
  { latin: "ye", fa: "ی\u0000ezafe" },
  // Comparative and superlative.
  { latin: "tarin", fa: "ترین" },
  { latin: "tar", fa: "تر" },
];

export interface Decomposition {
  prefix: Affix | undefined;
  stem: string;
  /** Innermost first, the order they are written in. */
  suffixes: Affix[];
}

/** The shortest Latin stem worth a lookup. `na·m` is not a split. */
const MIN_STEM = 3;

/**
 * Every split of `word` into an optional prefix, a stem, and at most two
 * suffixes. The unsplit word is not included — the caller already has it.
 */
export function decompose(word: string): Decomposition[] {
  const out: Decomposition[] = [];
  const prefixes: Array<Affix | undefined> = [undefined, ...PREFIXES.filter((p) => word.startsWith(p.latin))];
  for (const prefix of prefixes) {
    const rest = prefix ? word.slice(prefix.latin.length) : word;
    const peel = (stem: string, suffixes: Affix[], depth: number) => {
      if ((prefix || suffixes.length) && stem.length >= MIN_STEM) {
        out.push({ prefix, stem, suffixes: [...suffixes].reverse() });
      }
      if (depth === 2) return;
      for (const suffix of SUFFIXES) {
        if (stem.length - suffix.latin.length >= MIN_STEM && stem.endsWith(suffix.latin)) {
          peel(stem.slice(0, -suffix.latin.length), [...suffixes, suffix], depth + 1);
        }
      }
    };
    peel(rest, [], 0);
  }
  return out;
}

const LONG_VOWEL_FINAL = /[او]$/u;
export const EZAFE = "ی\u0000ezafe";

/**
 * Write a decomposition in Persian, with the joins the reference spellings use.
 *
 * Solid throughout, no ZWNJ — the rule engine's convention (see
 * `SkeletonIndex`). After a silent-he stem a personal clitic takes an alef
 * (خانهام, خانهاش); after ا or و the indefinite ی becomes یی (جایی) and after ی
 * it is not written twice. The ezafe is ی after ا or و (ماجرای, روی) and
 * unwritten everywhere else (کتاب, احساسی, درباره). The object marker و becomes
 * رو after a vowel, which is how it is spoken.
 */
export function compose(prefix: Affix | undefined, stem: string, suffixes: readonly Affix[]): string {
  let word = (prefix?.fa ?? "") + stem;
  for (const suffix of suffixes) {
    const silentHe = word.endsWith("ه");
    const longVowelFinal = LONG_VOWEL_FINAL.test(word);
    let fa = suffix.fa;
    if (fa === "م" || fa === "ت" || fa === "ش") {
      if (silentHe) fa = `ا${fa}`;
    } else if (fa === EZAFE) {
      fa = longVowelFinal ? "ی" : "";
    } else if (fa === "ی") {
      if (silentHe) fa = "ای";
      else if (longVowelFinal) fa = "یی";
      else if (word.endsWith("ی")) fa = "";
    } else if (fa === "و") {
      if (longVowelFinal || silentHe || word.endsWith("ی")) fa = "رو";
    }
    word += fa;
  }
  return word;
}

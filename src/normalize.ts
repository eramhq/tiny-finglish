/**
 * Persian text normalization.
 *
 * This module is written first and depended on by everything else, because
 * every accuracy number downstream is meaningless without it: a model that
 * emits ی U+06CC scored against a gold set containing ي U+064A looks broken
 * when it is correct, and a ZWNJ metric computed over un-hygienised text
 * measures whitespace noise rather than orthography.
 *
 * Two separate paths, deliberately:
 *   `normalize()` — display form. Idempotent, preserves meaning-bearing ZWNJ.
 *   `foldForMatch()` — lookup key. Lossy, strips ZWNJ, never shown to a user.
 *
 * Emitting Unicode bidi control characters is NOT part of normalization. See
 * `bidi.ts`; the W3C recommendation is that the fix belongs in the consumer's
 * markup, so we default to clean text.
 */

import {
  ARABIC_INDIC_DIGITS,
  BOM,
  buildFolder,
  HAMZA_ALEF_FOLDS,
  LETTER_FOLDS,
  PERSIAN_DIGITS,
  PUNCTUATION_FOLDS,
  TEH_MARBUTA_FOLD,
  ZWJ,
  ZWNJ,
} from "./unicode.ts";

export interface NormalizeOptions {
  /**
   * `"persian"` folds Arabic-Indic ٠-٩ to Persian ۰-۹ and leaves ASCII digits
   * alone — ASCII digits are ubiquitous and legitimate in Persian text.
   * `"latin"` folds both non-ASCII families to ASCII, which is what you want
   * for a match key or for text headed into a numeric parser.
   * `"preserve"` touches nothing.
   * @default "persian"
   */
  digits?: "persian" | "latin" | "preserve";
  /**
   * Fold أ and إ to ا. Removes a distinction no Finglish input can express,
   * so leaving it on keeps evaluation honest. Turn it off for corpus work
   * where Arabic loan spelling matters.
   * @default true
   */
  foldHamzaAlef?: boolean;
  /**
   * Fold ة to ه, per the Academy and Persian Wikipedia. hazm leaves it alone.
   * @default true
   */
  foldTehMarbuta?: boolean;
  /**
   * Convert ASCII `? ; ,` to `؟ ؛ ،`. Off by default: this is localization,
   * not normalization, and it is wrong inside a preserved Latin or URL span.
   * The transliteration pipeline enables it for Persian runs only.
   * @default false
   */
  punctuation?: boolean;
  /**
   * Collapse runs of whitespace to a single space and trim each line.
   * @default false
   */
  collapseWhitespace?: boolean;
}

const DEFAULTS: Required<NormalizeOptions> = {
  digits: "persian",
  foldHamzaAlef: true,
  foldTehMarbuta: true,
  punctuation: false,
  collapseWhitespace: false,
};

const foldLetters = buildFolder(LETTER_FOLDS);
const foldHamzaAlefChars = buildFolder(HAMZA_ALEF_FOLDS);
const foldTehMarbutaChar = buildFolder(TEH_MARBUTA_FOLD);
const foldPunctuationChars = buildFolder(PUNCTUATION_FOLDS);

/** Tatweel, harakat U+064B–U+0652, and superscript alef. U+0654 is NOT here. */
const DIACRITICS_RE = /[ـً-ْٰ]/gu;
/** Invisibles that carry no Persian meaning. ZWNJ is deliberately excluded. */
const DEAD_INVISIBLES_RE = new RegExp(`[${ZWJ}${BOM}\\u200E\\u200F\\u061C]`, "gu");

const ARABIC_INDIC_RE = /[٠-٩]/gu;
const PERSIAN_DIGIT_RE = /[۰-۹]/gu;

/**
 * Normalize Persian text to a single canonical display form.
 *
 * Idempotent: `normalize(normalize(x)) === normalize(x)` for every input,
 * which is asserted as a property test over the full variant table.
 */
export function normalize(input: string, options: NormalizeOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  if (input === "") return "";

  // 1. Drop invisibles that never mean anything, before normalization sees them.
  let s = input.replace(DEAD_INVISIBLES_RE, "");

  // 2. NFKC. Safe for ZWNJ (verified: NFKC leaves U+200C alone — the claim that
  //    it destroys ZWNJ comes from IDNA2008/UTS-46, which is about hostnames).
  //    This folds the Arabic Presentation Forms A/B that legacy CP1256
  //    converters and old PDFs emit constantly: ﺱ→س, ﯼ→ی, ﻻ→لا, ﷼→ریال.
  s = s.normalize("NFKC");

  // 3. Strip presentational marks. Must run after NFKC, which can introduce
  //    them, and must not touch U+0654 (needed for ۀ as ه+hamza).
  s = s.replace(DIACRITICS_RE, "");

  // 4. Letter folds. Must run after NFKC, which leaves ﻲ as ي U+064A and ﻰ as
  //    ى U+0649 — both still need folding to ی U+06CC.
  s = foldLetters(s);
  if (opts.foldHamzaAlef) s = foldHamzaAlefChars(s);
  if (opts.foldTehMarbuta) s = foldTehMarbutaChar(s);

  // 5. Digits.
  s = normalizeDigits(s, opts.digits);

  // 6. Punctuation, opt-in.
  if (opts.punctuation) s = foldPunctuationChars(s);

  // 7. ZWNJ hygiene. Regex only — `\b` does not work on Persian in JS.
  s = cleanZwnj(s);

  if (opts.collapseWhitespace) {
    s = s.replace(/[^\S\n]+/gu, " ").replace(/[^\S\n]*\n[^\S\n]*/gu, "\n").trim();
  }

  // 8. NFC as the output form. Never NFD/NFKD — those explode آ into ا + U+0653.
  //    ه + U+0654 has no precomposed form, so it survives this untouched.
  return s.normalize("NFC");
}

function normalizeDigits(s: string, mode: NormalizeOptions["digits"]): string {
  switch (mode) {
    case "persian":
      return s.replace(ARABIC_INDIC_RE, (d) => PERSIAN_DIGITS[d.charCodeAt(0) - 0x0660]!);
    case "latin":
      return s
        .replace(ARABIC_INDIC_RE, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(PERSIAN_DIGIT_RE, (d) => String(d.charCodeAt(0) - 0x06f0));
    default:
      return s;
  }
}

/**
 * ZWNJ hygiene. A ZWNJ is only meaningful *between two letters* — تنها
 * "alone" versus تن‌ها "bodies". Everywhere else it is invisible noise that
 * breaks string equality, and it arrives in real text by the thousand.
 */
function cleanZwnj(s: string): string {
  if (!s.includes(ZWNJ)) return s;
  return (
    s
      // Runs collapse to one.
      .replace(new RegExp(`${ZWNJ}{2,}`, "gu"), ZWNJ)
      // Adjacent to whitespace or punctuation it is inert — drop it and leave
      // the surrounding characters exactly as they were.
      .replace(new RegExp(`${ZWNJ}+(?=[\\s\\p{P}])`, "gu"), "")
      .replace(new RegExp(`(?<=[\\s\\p{P}])${ZWNJ}+`, "gu"), "")
      // Leading or trailing on any line.
      .replace(new RegExp(`^${ZWNJ}+|${ZWNJ}+$`, "gmu"), "")
  );
}

/**
 * Aggressive fold for lookup keys, deduplication and match-insensitive
 * comparison. Strips ZWNJ, so `تنها` and `تن‌ها` collide — that is the point.
 * Never use the result as display text.
 */
export function foldForMatch(input: string): string {
  return normalize(input, {
    digits: "latin",
    foldHamzaAlef: true,
    foldTehMarbuta: true,
    collapseWhitespace: true,
  })
    .replace(new RegExp(ZWNJ, "gu"), "")
    .replace(/ٔ/gu, "")
    .toLowerCase();
}

/** True when `input` is already in normal form. Cheap enough for assertions. */
export function isNormalized(input: string, options?: NormalizeOptions): boolean {
  return normalize(input, options) === input;
}

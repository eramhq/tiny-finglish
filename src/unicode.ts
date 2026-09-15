/**
 * Shared Unicode constants and character tables for Persian text.
 *
 * Everything here is data, not policy. Policy (what to fold, what to keep)
 * lives in `normalize.ts`.
 *
 * Verified against Unicode 16.0. The single most important fact in this file:
 * **NFKC does not fix Persian.** It leaves ك U+0643, ي U+064A, ى U+0649,
 * ة U+0629, tatweel U+0640 and every digit family completely unchanged, so the
 * tables below are load-bearing and cannot be replaced by a `.normalize()` call.
 */

/** Zero-width non-joiner. Script=Common (NOT Script=Arabic), Bidi_Class=BN. */
export const ZWNJ = "‌";
/** Zero-width joiner. Always deleted: it has no role in Persian orthography. */
export const ZWJ = "‍";
/** Byte-order mark / zero-width no-break space. Always deleted. */
export const BOM = "﻿";
/** Arabic tatweel (kashida). Purely presentational; always deleted. */
export const TATWEEL = "ـ";
/** Arabic hamza above. Load-bearing for ه‌ٔ — must survive harakat stripping. */
export const HAMZA_ABOVE = "ٔ";

/**
 * `\b` is useless on Persian in JavaScript: `/\w/u.test("ی")` is `false`, so
 * `/\bمی/u` never matches inside Persian text. Any regex ported from a Python
 * Persian library that relies on `\b` is silently broken here. Use these
 * classes for boundaries instead.
 */
export const PERSIAN_LETTER_CLASS = "\\u0621-\\u063A\\u0641-\\u064A\\u066E-\\u06D3\\u06D5\\u06FF";
export const PERSIAN_LETTER_RE = new RegExp(`[${PERSIAN_LETTER_CLASS}]`, "u");

/** The 32 letters of the Persian alphabet, plus the hamza carriers we keep. */
export const PERSIAN_ALPHABET = "ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی";

/**
 * Letters after which a ZWNJ is a visual no-op, because they do not join to
 * the left anyway. Persian Wikipedia's bot deletes ZWNJ here; hazm keeps it.
 * We keep it — it is semantically inert but lets round-tripping stay lossless,
 * and the match-fold strips ZWNJ so it never affects lookup or scoring.
 */
export const NON_JOINING_FINALS = "ادذرزژوآأإؤءةۀ";

/** Persian (extended Arabic-Indic) digits ۰-۹ — Bidi_Class=EN, the correct set. */
export const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
/** Arabic-Indic digits ٠-٩ — Bidi_Class=AN, FORBIDDEN by ISIRI 6219. */
export const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const LATIN_DIGITS = "0123456789";

/**
 * Letter folds applied after NFKC. Ordered longest-source-first is unnecessary
 * here because every source is a single code point.
 *
 * `ۀ` is the subtle one. Three encodings exist:
 *   U+06C0            — forbidden by ISIRI 6219, discouraged by Unicode 16 ch.9
 *   U+06D5 U+0654     — recomposes to the forbidden U+06C0 under NFC
 *   U+0647 U+0654     — correct, and the only one stable under every form
 * We normalize to the third. `HAMZA_ABOVE` is therefore excluded from the
 * harakat strip; libraries that delete U+0654 wholesale destroy this.
 */
export const LETTER_FOLDS: ReadonlyArray<readonly [string, string]> = [
  // → ی U+06CC FARSI YEH
  ["ى", "ی"], // ى ALEF MAKSURA
  ["ي", "ی"], // ي ARABIC YEH
  ["ۍ", "ی"], // ۍ YEH WITH TAIL
  ["ے", "ی"], // ے YEH BARREE
  ["ې", "ی"], // ې E
  // → ک U+06A9 KEHEH
  ["ك", "ک"], // ك ARABIC KAF
  ["ڪ", "ک"], // ڪ SWASH KAF
  // → ه U+0647 HEH
  ["ہ", "ه"], // ہ HEH GOAL
  ["ە", "ه"], // ە AE
  // → ه + hamza (the correct ۀ)
  ["ۀ", "هٔ"], // ۀ HEH WITH YEH ABOVE
  // → ا U+0627 ALEF
  ["ٱ", "ا"], // ٱ ALEF WASLA
];

/** Optional folds, gated behind `normalize()` options. */
export const HAMZA_ALEF_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ["أ", "ا"], // أ
  ["إ", "ا"], // إ
];
export const TEH_MARBUTA_FOLD: ReadonlyArray<readonly [string, string]> = [
  ["ة", "ه"], // ة → ه
];

/**
 * Persian punctuation. `؟` U+061F and `؛` U+061B are Bidi_Class=AL (strong
 * RTL), so emitting them instead of the ASCII forms is a free bidi fix.
 * `،` U+060C is Bidi_Class=CS, identical to ASCII comma — typography only.
 */
export const PUNCTUATION_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ["?", "؟"],
  [";", "؛"],
  [",", "،"],
];

/** Build a single-pass replacer from [from, to] pairs of single code points. */
export function buildFolder(
  pairs: ReadonlyArray<readonly [string, string]>,
): (input: string) => string {
  const table = new Map(pairs);
  const charClass = pairs.map(([from]) => escapeForClass(from)).join("");
  const re = new RegExp(`[${charClass}]`, "gu");
  return (input) => input.replace(re, (ch) => table.get(ch) ?? ch);
}

function escapeForClass(ch: string): string {
  return `\\u${ch.codePointAt(0)!.toString(16).padStart(4, "0")}`;
}

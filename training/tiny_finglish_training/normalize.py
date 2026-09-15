"""Persian normalization — a deliberate mirror of ``src/normalize.ts``.

The two implementations are kept honest by ``data/fixtures/normalization.jsonl``:
both the TypeScript suite and ``tests/test_normalize.py`` run every case in it
and assert the same output. If you change one implementation, change the other
and the fixture file together, or CI fails.

Why duplicate rather than shell out to Node: training runs must not depend on a
JavaScript toolchain, and a subprocess per word would dominate corpus-build
time. The cost is that this file must be kept in sync, which the shared fixture
makes mechanical.
"""

from __future__ import annotations

import re
import unicodedata

ZWNJ = "‌"
ZWJ = "‍"
BOM = "﻿"
HAMZA_ABOVE = "ٔ"

# --- tables, mirroring src/unicode.ts -------------------------------------

LETTER_FOLDS = {
    "ى": "ی",  # ى -> ی
    "ي": "ی",  # ي -> ی
    "ۍ": "ی",  # ۍ -> ی
    "ے": "ی",  # ے -> ی
    "ې": "ی",  # ې -> ی
    "ك": "ک",  # ك -> ک
    "ڪ": "ک",  # ڪ -> ک
    "ہ": "ه",  # ہ -> ه
    "ە": "ه",  # ە -> ه
    "ۀ": "هٔ",  # ۀ -> ه + hamza (the only form stable under NFC)
    "ٱ": "ا",  # ٱ -> ا
}
HAMZA_ALEF_FOLDS = {"أ": "ا", "إ": "ا"}
TEH_MARBUTA_FOLD = {"ة": "ه"}
PUNCTUATION_FOLDS = {"?": "؟", ";": "؛", ",": "،"}

PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

# Tatweel, harakat, superscript alef. U+0654 is deliberately absent: it is
# load-bearing for ۀ written as ه + hamza.
_DIACRITICS = re.compile(r"[ـً-ْٰ]")
_DEAD_INVISIBLES = re.compile(f"[{ZWJ}{BOM}‎‏؜]")
_ARABIC_INDIC = re.compile(r"[٠-٩]")
_PERSIAN_DIGIT = re.compile(r"[۰-۹]")

_LETTER_RE = re.compile("[" + "".join(LETTER_FOLDS) + "]")
_HAMZA_ALEF_RE = re.compile("[" + "".join(HAMZA_ALEF_FOLDS) + "]")
_TEH_MARBUTA_RE = re.compile("[" + "".join(TEH_MARBUTA_FOLD) + "]")
_PUNCT_RE = re.compile("[" + re.escape("".join(PUNCTUATION_FOLDS)) + "]")

# Python's ``re`` has no \p{P}; enumerate the categories once at import.
_PUNCT_OR_SPACE = "".join(
    chr(cp)
    for cp in range(0x2E80)
    if unicodedata.category(chr(cp)).startswith("P") or chr(cp).isspace()
)
_ZWNJ_RUN = re.compile(f"{ZWNJ}{{2,}}")
_ZWNJ_BEFORE = re.compile(f"{ZWNJ}+(?=[{re.escape(_PUNCT_OR_SPACE)}])")
_ZWNJ_AFTER = re.compile(f"(?<=[{re.escape(_PUNCT_OR_SPACE)}]){ZWNJ}+")
_ZWNJ_EDGE = re.compile(f"^{ZWNJ}+|{ZWNJ}+$", re.MULTILINE)


def normalize(
    text: str,
    *,
    digits: str = "persian",
    fold_hamza_alef: bool = True,
    fold_teh_marbuta: bool = True,
    punctuation: bool = False,
    collapse_whitespace: bool = False,
) -> str:
    """Normalize Persian text to a canonical display form. Idempotent."""
    if not text:
        return ""

    s = _DEAD_INVISIBLES.sub("", text)
    # NFKC folds the Arabic Presentation Forms that legacy encoders emit and
    # leaves ZWNJ alone. It does NOT fix ك/ي/ة/tatweel/digits — hence the tables.
    s = unicodedata.normalize("NFKC", s)
    s = _DIACRITICS.sub("", s)
    s = _LETTER_RE.sub(lambda m: LETTER_FOLDS[m.group()], s)
    if fold_hamza_alef:
        s = _HAMZA_ALEF_RE.sub(lambda m: HAMZA_ALEF_FOLDS[m.group()], s)
    if fold_teh_marbuta:
        s = _TEH_MARBUTA_RE.sub(lambda m: TEH_MARBUTA_FOLD[m.group()], s)
    s = _normalize_digits(s, digits)
    if punctuation:
        s = _PUNCT_RE.sub(lambda m: PUNCTUATION_FOLDS[m.group()], s)
    s = _clean_zwnj(s)
    if collapse_whitespace:
        s = re.sub(r"[^\S\n]+", " ", s)
        s = re.sub(r"[^\S\n]*\n[^\S\n]*", "\n", s).strip()
    return unicodedata.normalize("NFC", s)


def _normalize_digits(s: str, mode: str) -> str:
    if mode == "persian":
        return _ARABIC_INDIC.sub(lambda m: PERSIAN_DIGITS[ord(m.group()) - 0x0660], s)
    if mode == "latin":
        s = _ARABIC_INDIC.sub(lambda m: str(ord(m.group()) - 0x0660), s)
        return _PERSIAN_DIGIT.sub(lambda m: str(ord(m.group()) - 0x06F0), s)
    return s


def _clean_zwnj(s: str) -> str:
    if ZWNJ not in s:
        return s
    s = _ZWNJ_RUN.sub(ZWNJ, s)
    s = _ZWNJ_BEFORE.sub("", s)
    s = _ZWNJ_AFTER.sub("", s)
    return _ZWNJ_EDGE.sub("", s)


def fold_for_match(text: str) -> str:
    """Lossy lookup key. Strips ZWNJ, so تنها and تن‌ها collide by design."""
    s = normalize(text, digits="latin", collapse_whitespace=True)
    return s.replace(ZWNJ, "").replace(HAMZA_ABOVE, "").lower()


def is_normalized(text: str, **kwargs) -> bool:
    return normalize(text, **kwargs) == text

"""Reader for the committed Persian pronunciation dictionary.

Built by ``build_pronunciation.py`` from HomoRich (CC0-1.0). Maps a normalized
Persian word to its phoneme string, e.g. کتاب -> ``ketAb``.

The generator consumes only the short vowels (a, e, o). Long vowels are already
written in the Persian, and the consonants are already known from the grapheme
table — the short vowels are the one thing the script does not record and the
generator previously had to guess.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import brotli

PRONUNCIATION_PATH = Path(__file__).resolve().parents[2] / "data" / "lexicon" / "fa-pronunciation.bin"

SHORT_VOWELS = frozenset("aeo")


@lru_cache(maxsize=1)
def load(path: Path | None = None) -> dict[str, str]:
    """Persian word -> phoneme string. Empty when the artifact is absent.

    Absence is not an error: the generator falls back to sampling short vowels,
    which is how it behaved before this dictionary existed. It is only worse,
    not broken.
    """
    target = path or PRONUNCIATION_PATH
    if not target.exists():
        return {}
    text = brotli.decompress(target.read_bytes()).decode("utf-8")
    out: dict[str, str] = {}
    for line in text.splitlines():
        word, _, phoneme = line.partition("\t")
        if word and phoneme:
            out[word] = phoneme
    return out


def short_vowels(phoneme: str) -> list[str]:
    """The short vowels of a phoneme string, in order.

    ``ketAb`` -> ``['e']``; ``bozorg`` -> ``['o', 'o']``. Long vowels (A, u, i)
    are excluded because the Persian script already writes them.
    """
    return [c for c in phoneme if c in SHORT_VOWELS]


@lru_cache(maxsize=1)
def coverage() -> int:
    return len(load())

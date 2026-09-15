"""Reader for the committed front-coded lexicon artifact.

Mirrors ``src/frontcode.ts``. The format is documented there; this side only
decodes. ``tests/test_frontcode.py`` asserts the two agree on the real file.
"""

from __future__ import annotations

import struct
from functools import lru_cache
from pathlib import Path

import brotli

LEXICON_PATH = Path(__file__).resolve().parents[2] / "data" / "lexicon" / "fa-stems.bin"

TERMINATOR = 0xFF


def decode_front_coded(data: bytes) -> list[str]:
    offset = 0
    alphabet_length = data[offset]
    offset += 1
    alphabet = []
    for _ in range(alphabet_length):
        (unit,) = struct.unpack_from("<H", data, offset)
        alphabet.append(chr(unit))
        offset += 2
    (count,) = struct.unpack_from("<I", data, offset)
    offset += 4

    words: list[str] = []
    previous = ""
    for _ in range(count):
        shared = data[offset]
        offset += 1
        chars = []
        while data[offset] != TERMINATOR:
            chars.append(alphabet[data[offset]])
            offset += 1
        offset += 1
        previous = previous[:shared] + "".join(chars)
        words.append(previous)
    return words


@lru_cache(maxsize=1)
def load(path: Path | None = None) -> tuple[str, ...]:
    """The Persian stem list, sorted, already normalized at build time."""
    target = path or LEXICON_PATH
    if not target.exists():
        raise FileNotFoundError(
            f"{target} is missing. Run `node scripts/build-lexicon.ts` after "
            f"`scripts/fetch-lexicon.sh`."
        )
    return tuple(decode_front_coded(brotli.decompress(target.read_bytes())))

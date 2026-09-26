"""The vowel-agreement builder: ezafe stripping, and the committed artifact."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import brotli
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training.build_vowels import DEFAULT_OUT, strip_ezafe, vowels  # noqa: E402
from tiny_finglish_training.lexicon import decode_front_coded  # noqa: E402

PROVENANCE = Path(__file__).resolve().parents[2] / "data" / "provenance" / "vowels.json"


def test_strips_the_ezafe_on_a_consonant_final_word():
    # HomoRich transcribes in context: سهم carries its ezafe as `sahme`.
    assert strip_ezafe("سهم", "sahme") == "sahm"
    assert strip_ezafe("عاشق", "?ASeqe") == "?ASeq"


def test_keeps_a_real_final_vowel():
    # A word written with a final ه or ی ends in its own vowel, not an ezafe.
    assert strip_ezafe("خانه", "xAne") == "xAne"
    assert strip_ezafe("کی", "ki") == "ki"


def test_strips_the_ye_of_an_ezafe_after_a_vowel_letter():
    assert strip_ezafe("خدا", "xodAye") == "xodA"
    assert strip_ezafe("زندگی", "zendegiye") == "zendegi"


def test_vowels_are_the_six_vowel_phonemes_in_order():
    assert vowels("salAm") == "aA"
    assert vowels("sAlem") == "Ae"
    assert vowels("?ASeq") == "Ae"


@pytest.mark.skipif(not DEFAULT_OUT.exists(), reason="vowel artifact not built")
def test_artifact_matches_its_provenance_and_decodes():
    data = DEFAULT_OUT.read_bytes()
    manifest = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    assert hashlib.sha256(data).hexdigest() == manifest["sha256"]

    raw = brotli.decompress(data)
    words = decode_front_coded(raw)
    assert len(words) == manifest["kept"]
    # Vowel strings follow the word list, one per word, newline-terminated,
    # over the six-letter vowel alphabet only.
    strings = raw[raw.rfind(b"\xff") + 1:].decode("ascii").split("\n")
    assert strings[-1] == ""
    table = dict(zip(words, strings[:-1], strict=True))
    assert set("".join(table.values())) <= set("aeoAiu")
    assert table["سلام"] == "aA"
    assert table["سالم"] == "Ae"

"""The generator must be lossless and its syllabification must be sane.

Losslessness is the load-bearing property: every training label stream has to
concatenate back to the exact Persian word it came from, or the model is being
trained on a target it can never reproduce.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training.g2p import FinglishGenerator, _is_legal_coda  # noqa: E402
from tiny_finglish_training.labels import align_to_labels, labels_to_persian  # noqa: E402
from tiny_finglish_training.lexicon import load as load_lexicon  # noqa: E402

WORDS = [
    "سلام", "امروز", "کتاب", "دست", "مرد", "بزرگ", "خوب", "بد", "خانه",
    "دانشگاه", "دوست", "خواب", "خواهر", "دانش", "جنگ", "ایران", "نامه",
]


@pytest.mark.parametrize("word", WORDS)
def test_chunks_reconstruct_the_word(word):
    generator = FinglishGenerator(seed=1)
    for _ in range(20):
        chunks = generator.generate(word)
        assert "".join(c.fa for c in chunks) == word


@pytest.mark.parametrize("word", WORDS)
def test_labels_align_one_per_latin_character(word):
    generator = FinglishGenerator(seed=2)
    for _ in range(20):
        latin, labels = align_to_labels(generator.generate(word))
        assert len(latin) == len(labels)
        assert labels_to_persian(labels) == word


def test_lossless_over_a_lexicon_sample():
    """The property that matters at corpus scale, not just on hand-picked words."""
    words = load_lexicon()[::997]
    generator = FinglishGenerator(seed=3)
    failures = []
    for word in words:
        for _ in range(3):
            latin, labels = align_to_labels(generator.generate(word))
            if len(latin) != len(labels) or labels_to_persian(labels) != word:
                failures.append(word)
                break
    assert not failures, f"{len(failures)} of {len(words)} words failed: {failures[:10]}"


@pytest.mark.parametrize(
    "word,pattern",
    [
        ("امروز", r"^[aeo]mrooz$"),      # و is a vowel, not /v/
        ("خوب", r"^khoob$"),
        ("دوست", r"^doost$"),
        ("خواب", r"^khaab$"),            # the silent و of خوا
        ("خواهر", r"^khaah[aeo]r$"),
        ("ایران", r"^iraan$"),           # word-initial ای is one long vowel
        ("دانش", r"^daan[aeo]sh$"),      # نش is not a legal coda: a vowel is inserted
        ("جنگ", r"^j[aeo]ng$"),          # نگ is a legal coda: none is
        ("دست", r"^d[aeo]st$"),
        ("بزرگ", r"^b[aeo]z[aeo]rg$"),   # maximal onset: bo-zorg, not ba-zrag
        ("مسقط", r"^m[aeo]s(gh|q)[aeo]t$"),  # forced coda: mas-ghat, not me-se-ghet
        ("دویدن", r"^d[aeo]vid[aeo]n$"),  # و before ی is a consonant
    ],
)
def test_syllable_structure(word, pattern):
    """Pin the consonant/long-vowel skeleton, not short-vowel quality.

    The syllabifier is engineered and must be correct; short-vowel *quality* is
    sampled from a prior because we have no pronunciation dictionary, so
    asserting an exact string here would be asserting a coin flip. See the
    module docstring of ``g2p.py``.
    """
    generator = FinglishGenerator(seed=7, variant_rate=0.0)
    seen = {generator.romanize(word) for _ in range(30)}
    bad = [s for s in seen if not re.match(pattern, s)]
    assert not bad, f"{word}: {bad} do not match {pattern} (all: {sorted(seen)})"


def test_variation_produces_realistic_alternatives():
    generator = FinglishGenerator(seed=11, variant_rate=0.5)
    spellings = {generator.romanize("امروز") for _ in range(40)}
    assert len(spellings) >= 4, spellings


@pytest.mark.parametrize("cluster,legal", [
    ("ست", True), ("رد", True), ("نگ", True), ("بز", True), ("بح", True),
    ("نم", False), ("نش", False), ("دن", False),
    ("ر", True), ("سته", False),
])
def test_coda_legality(cluster, legal):
    assert _is_legal_coda(cluster) is legal

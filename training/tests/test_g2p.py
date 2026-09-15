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


#: Spelling alternatives the weighted sampler may legitimately produce. The
#: structure tests below pin the *syllable skeleton*, not the spelling — since
#: weights were measured from real Finglish, every one of these is something a
#: real person writes.
U = r"(?:oo|u|ou|o|ow|au)"   # long uː / oː
A = r"(?:aa|a|â)"            # long ɒː
I = r"(?:i|ee|y|ey|ei|ay|ai)"  # long iː and its diphthong spellings
V = r"[aeo]"                 # an inserted (unwritten) short vowel
W = r"(?:v|w)"               # consonantal و; `w` is rare but attested (1.6%)


@pytest.mark.parametrize(
    "word,pattern",
    [
        ("امروز", rf"^{V}mr{U}z$"),        # و is a vowel, not /v/
        ("خوب", rf"^kh{U}b$"),
        ("دوست", rf"^d{U}st$"),
        ("خواب", rf"^kh{A}b$"),            # the silent و of خوا
        ("خواهر", rf"^kh{A}h{V}r$"),
        ("ایران", rf"^{I}r{A}n$"),         # word-initial ای is one long vowel
        ("دانش", rf"^d{A}n{V}sh$"),        # نش is not a legal coda: a vowel is inserted
        ("جنگ", rf"^j{V}ng$"),             # نگ is, so none is
        ("دست", rf"^d{V}st$"),
        ("بزرگ", rf"^b{V}z{V}rg$"),        # maximal onset: bo-zorg, not ba-zrag
        ("مسقط", rf"^m{V}s(?:gh|q){V}t$"), # forced coda: mas-ghat, not me-se-ghet
        ("دویدن", rf"^d{V}{W}{I}d{V}n$"),  # و before ی is a consonant
    ],
)
def test_syllable_structure(word, pattern):
    """Pin the consonant/long-vowel skeleton, not the spelling.

    The syllabifier is engineered and must be correct. Two things around it are
    deliberately stochastic and must NOT be asserted exactly:

      * short-vowel *quality*, sampled from a prior because there is no
        pronunciation dictionary (see the module docstring of ``g2p.py``);
      * variant *spellings*, sampled from weights measured over real Finglish
        (`latinWeights` in ``src/rules.ts``) — `khoob`, `khub` and `khoub` are
        all things people actually write for خوب.

    So the patterns fix the skeleton and leave both free.
    """
    generator = FinglishGenerator(seed=7)
    seen = {generator.romanize(word) for _ in range(60)}
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


@pytest.mark.parametrize("word", ["معلم", "سئوال", "مؤمن", "جزء", "بعد", "شعر"])
def test_latin_side_never_carries_persian_letters(word):
    """ع ء ئ ؤ exist only in the table's `silent` role. A consonant-slot lookup
    that missed them once wrote the Persian letter into the Latin string —
    `aabaعli` — for 5% of the training corpus."""
    generator = FinglishGenerator(seed=3)
    for _ in range(30):
        latin, _labels = align_to_labels(generator.generate(word))
        assert re.fullmatch(r"[a-zâ' -]*", latin), latin

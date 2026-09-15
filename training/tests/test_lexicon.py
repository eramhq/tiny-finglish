"""The committed lexicon artifact must decode identically in Python and JS."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training.lexicon import LEXICON_PATH, load  # noqa: E402
from tiny_finglish_training.normalize import normalize  # noqa: E402


@pytest.mark.skipif(not LEXICON_PATH.exists(), reason="lexicon artifact not built")
def test_lexicon_decodes():
    words = load()
    assert len(words) > 90_000
    assert list(words) == sorted(words)
    assert len(set(words)) == len(words)


@pytest.mark.skipif(not LEXICON_PATH.exists(), reason="lexicon artifact not built")
def test_lexicon_is_already_normalized():
    """Entries are normalized at build time, so model output can be compared
    against them directly without a per-lookup normalize call."""
    for word in load()[::500]:
        assert normalize(word) == word

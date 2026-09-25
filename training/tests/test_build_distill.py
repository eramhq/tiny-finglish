"""`mix()`'s three ways of reaching a requested LLM share.

The interesting one is the floor. `natural` can only raise the LLM share by
throwing synthetic examples away, so a share below
`len(llm) / (len(llm) + len(synthetic))` is not reachable at all and the corpus
lands above the request. On the real corpus that floor is 26.1%, which is why
`--mode natural --share 0.25` and `--mode none` build the same file.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training.build_distill import (  # noqa: E402
    MIX_MODES,
    ends_in_he,
    sentence_id,
    train_split,
    write_shards,
)


def halves(n_synthetic: int, n_llm: int, share: float, mode: str, seed: int = 0):
    synthetic = [f"s{i}" for i in range(n_synthetic)]
    llm = [f"l{i}" for i in range(n_llm)]
    return train_split(synthetic, llm, share, mode, random.Random(seed))


def test_modes_are_the_documented_three():
    assert MIX_MODES == ("upsample", "natural", "none")


def test_upsample_repeats_the_llm_half_to_reach_the_share():
    synthetic, from_llm = halves(1000, 100, 0.5, "upsample")
    assert len(synthetic) == 1000
    assert len(from_llm) == 1000
    # Repetition, not sampling: every LLM example appears, ten times each.
    assert set(from_llm) == {f"l{i}" for i in range(100)}
    assert len(set(from_llm)) == 100


def test_upsample_never_drops_a_synthetic_example():
    for share in (0.1, 0.25, 0.5, 0.9):
        synthetic, _ = halves(1000, 100, share, "upsample")
        assert len(synthetic) == 1000


def test_natural_downsamples_the_synthetic_half_and_repeats_nothing():
    synthetic, from_llm = halves(1000, 100, 0.5, "natural")
    assert len(from_llm) == 100
    assert len(set(from_llm)) == 100
    assert len(synthetic) == 100
    assert len(set(synthetic)) == 100


def test_natural_hits_the_requested_share_when_it_is_above_the_floor():
    synthetic, from_llm = halves(1000, 100, 0.2, "natural")
    total = len(synthetic) + len(from_llm)
    assert len(from_llm) / total == 0.2


def test_natural_below_the_floor_keeps_every_synthetic_example():
    # Floor is 100 / 1100 = 9.1%; 5% is unreachable without repeating the LLM half.
    synthetic, from_llm = halves(1000, 100, 0.05, "natural")
    assert len(synthetic) == 1000
    assert len(from_llm) == 100
    assert len(from_llm) / (len(synthetic) + len(from_llm)) > 0.05


def test_natural_below_the_floor_equals_mode_none():
    assert halves(1000, 100, 0.05, "natural") == halves(1000, 100, 0.05, "none")


def test_none_ignores_the_share_entirely():
    for share in (0.0, 0.25, 0.5, 1.0):
        synthetic, from_llm = halves(1000, 100, share, "none")
        assert len(synthetic) == 1000
        assert len(from_llm) == 100


def test_the_two_ends_are_the_same_in_every_mode():
    for mode in MIX_MODES:
        if mode == "none":
            continue
        assert halves(1000, 100, 1.0, mode) == ([], [f"l{i}" for i in range(100)])
        assert halves(1000, 100, 0.0, mode) == ([f"s{i}" for i in range(1000)], [])


def test_natural_is_deterministic_for_a_seed():
    assert halves(1000, 100, 0.5, "natural", seed=7) == halves(1000, 100, 0.5, "natural", seed=7)
    assert halves(1000, 100, 0.5, "natural", seed=7) != halves(1000, 100, 0.5, "natural", seed=8)


def test_rows_are_passed_through_untouched():
    row = json.dumps({"latin": "salam", "labels": ["s"], "persian": "سلام"}, ensure_ascii=False)
    synthetic, from_llm = train_split(["x"], [row], 0.5, "none", random.Random(0))
    assert from_llm == [row]
    assert synthetic == ["x"]


# -- shard numbering and the clause-final ه predicate ------------------------


def test_ends_in_he_looks_only_at_the_last_word():
    assert ends_in_he(["هوا", "خوبه"])
    assert not ends_in_he(["خوبه", "هوا"])
    assert not ends_in_he(["پنجره", "شکست"])
    # The word's own ه counts too: the predicate is about the written form, and
    # whether that ه is a clitic is exactly what the engine has to decide.
    assert ends_in_he(["پرید", "پرنده"])


def test_sentence_id_is_stable_and_word_order_sensitive():
    assert sentence_id(["a", "b"]) == sentence_id(["a", "b"])
    assert sentence_id(["a", "b"]) != sentence_id(["b", "a"])
    assert sentence_id(["a", "b"]).startswith("hr-")


def test_write_shards_numbers_from_the_start_offset(tmp_path):
    rows = [{"id": f"hr-{i}", "words": ["x"]} for i in range(6)]
    write_shards(rows, tmp_path, shards=3, start=69)
    assert sorted(p.name for p in tmp_path.glob("shard-*.jsonl")) == [
        "shard-69.jsonl", "shard-70.jsonl", "shard-71.jsonl",
    ]
    assert sum(len(p.read_text().splitlines()) for p in tmp_path.glob("shard-*.jsonl")) == 6


def test_write_shards_refuses_to_overwrite_a_previous_round(tmp_path):
    rows = [{"id": "hr-1", "words": ["x"]}]
    write_shards(rows, tmp_path, shards=1, start=0)
    with pytest.raises(SystemExit):
        write_shards(rows, tmp_path, shards=1, start=0)

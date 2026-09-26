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
from tiny_finglish_training import build_distill  # noqa: E402
from tiny_finglish_training.build_distill import (  # noqa: E402
    LLM_SPLITS,
    MIX_MODES,
    PREDICATES,
    ends_in_he,
    has_chat_word,
    llm_split_of,
    read_sentences,
    sample,
    sentence_id,
    train_split,
    write_shards,
)
from tiny_finglish_training.build_frequency import (  # noqa: E402
    EVALUATION_FILES,
    leak_key,
    load_gold_keys,
    load_ngrams,
    supplement_words,
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


# -- the chat round: sources, predicates, and the words-level leakage guard ----

ZWNJ = "\u200c"


def write_jsonl(path: Path, rows: list[dict]) -> Path:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    return path


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    """`sample` with evaluation files the test controls, and no real chat sets."""
    gold = write_jsonl(tmp_path / "gold.jsonl", [{"id": "g1", "expected": "سلام خوبی"}])
    chat = write_jsonl(tmp_path / "chat.jsonl", [{"id": "c1", "expected": "فردا ساعت پنج میام دنبالت"}])
    monkeypatch.setattr(build_distill, "EVALUATION_FILES", [gold, chat])
    monkeypatch.setattr(build_distill, "CHAT_FILES", [chat])
    return tmp_path


def test_leak_key_is_the_words_not_the_string():
    assert leak_key("سلام، خوبی؟") == leak_key("سلام خوبی")
    assert leak_key("سلام خوبی!!") == leak_key("  سلام   خوبی ")
    assert leak_key(f"می{ZWNJ}خوام") == leak_key("میخوام")
    assert leak_key("سلام خوبی") != leak_key("خوبی سلام")


def test_evaluation_files_include_the_fixtures_and_both_chat_sets():
    names = {p.name for p in EVALUATION_FILES}
    assert {"fixtures.jsonl", "chat-dev.jsonl", "chat-test.jsonl", "gold.jsonl", "dev.jsonl"} <= names


def test_gold_keys_skip_rows_with_no_persian_reference(tmp_path):
    path = write_jsonl(tmp_path / "f.jsonl", [
        {"id": "p1", "expected": None},
        {"id": "p2", "expected": "سلام، خوبی؟"},
    ])
    assert load_gold_keys(path) == {leak_key("سلام خوبی")}


def test_ngrams_are_folded_like_the_key(tmp_path):
    path = write_jsonl(tmp_path / "c.jsonl", [{"id": "c", "expected": f"من می{ZWNJ}خوام برم خونه"}])
    assert load_ngrams(path) == {("من", "میخوام", "برم", "خونه")}


def test_read_sentences_takes_jsonl_and_text(tmp_path):
    j = write_jsonl(tmp_path / "a.jsonl", [{"id": "1", "text": "سلام"}, {"id": "2", "text": "باشه"}])
    t = tmp_path / "a.txt"
    t.write_text("# comment\nسلام\n\nباشه\n", encoding="utf-8")
    assert read_sentences(j) == ["سلام", "باشه"]
    assert read_sentences(t) == ["سلام", "باشه"]


def test_sample_drops_punctuation_variants_of_an_evaluation_sentence(isolated):
    source = isolated / "src.txt"
    source.write_text("سلام، خوبی؟\nسلام خوبی\nمرسی عزیزم\n", encoding="utf-8")
    rows = sample(source, 0, seed=1, min_words=1)
    assert [r["words"] for r in rows] == [["مرسی", "عزیزم"]]


def test_sample_drops_a_line_sharing_four_words_with_a_chat_message(isolated):
    source = isolated / "src.txt"
    source.write_text("باشه فردا ساعت پنج میام\nفردا ساعت شش میام\n", encoding="utf-8")
    rows = sample(source, 0, seed=1, min_words=1)
    # "فردا ساعت پنج میام" is four words of the chat message; the other shares three.
    assert [r["words"] for r in rows] == [["فردا", "ساعت", "شش", "میام"]]


def test_sample_min_words_and_id_prefix(isolated):
    source = write_jsonl(isolated / "src.jsonl", [{"text": "باشه"}, {"text": "باشه عزیزم"}])
    assert sample(source, 0, seed=1, min_words=4) == []
    rows = sample(source, 0, seed=1, min_words=1, id_prefix="ch-")
    assert sorted(len(r["words"]) for r in rows) == [1, 2]
    assert all(r["id"].startswith("ch-") for r in rows)
    assert {r["id"] for r in rows} == {sentence_id(["باشه"], "ch-"), sentence_id(["باشه", "عزیزم"], "ch-")}


def test_chat_word_predicate_needs_a_marker_and_no_written_register():
    assert has_chat_word(["مرسی", "عزیزم"])
    assert has_chat_word([f"می{ZWNJ}خوام", "برم"])
    assert not has_chat_word(["هوا", "سرد"])
    # خوبی in written register: the ! markers keep it out.
    assert not has_chat_word(["این", "کار", "به", "خوبی", "انجام", "می‌شود"])
    assert not has_chat_word(["سلام", "این", "کتاب", "است"])
    assert set(PREDICATES) == {"ends-in-he", "chat-word"}


def test_targeted_chat_draw_takes_only_chat_lines(isolated):
    source = isolated / "src.txt"
    source.write_text("مرسی عزیزم\nهوا سرد شد\nباشه میام\nکتاب را خواندم\n", encoding="utf-8")
    rows = sample(source, 2, seed=3, min_words=1, targeted=2, predicate=has_chat_word)
    assert sorted(" ".join(r["words"]) for r in rows) == ["باشه میام", "مرسی عزیزم"]


def test_llm_split_by_word_or_by_sentence():
    from tiny_finglish_training.corpus import split_of

    assert LLM_SPLITS == ("word", "sentence")
    row = {"persian": "خوبی", "id": "hr-0123456789"}
    assert llm_split_of(row, "word") == split_of("خوبی")
    assert llm_split_of(row, "sentence") == split_of("hr-0123456789")
    # Every example of one sentence lands together, whatever its words.
    assert {llm_split_of({"persian": w, "id": "ch-x"}, "sentence") for w in ("سلام", "خوبی", "مرسی")} == {
        split_of("ch-x")}
    with pytest.raises(SystemExit):
        llm_split_of({"persian": "خوبی"}, "sentence")


def test_sentence_split_trains_on_a_word_the_word_split_holds_out():
    from tiny_finglish_training.corpus import split_of

    # The reason the arm exists, pinned: خوبی is a test word.
    assert split_of("خوبی") == "test"
    trained = [i for i in range(50) if llm_split_of({"persian": "خوبی", "id": f"ch-{i}"}, "sentence") == "train"]
    assert len(trained) > 30


def test_supplement_adds_out_of_table_words_seen_twice(tmp_path):
    gold = write_jsonl(tmp_path / "gold.jsonl", [{"id": "g", "expected": "کجایی فدات"}])
    pool = write_jsonl(tmp_path / "pool.jsonl", [
        {"text": "کجایی؟ فدات شم"},
        {"words": ["کجایی", "داداش"]},
        {"text": f"من می{ZWNJ}خوام برم"},
        {"text": "میخوام بخوابم"},
        {"text": "کجایی فدات"},  # an evaluation sentence: never counted
    ])
    added = supplement_words([pool], table={"من", "برم", "شم"}, golds=[gold], min_count=2)
    # کجایی twice; فدات once outside the evaluation line; the two spellings of
    # میخوام are one word; table words and singletons stay out.
    assert added == {"کجایی": 2, f"می{ZWNJ}خوام": 2}


def test_supplement_skips_a_word_whose_solid_form_is_in_the_table(tmp_path):
    pool = write_jsonl(tmp_path / "pool.jsonl", [{"text": "میخوام"}, {"text": "میخوام"}])
    assert supplement_words([pool], table={f"می{ZWNJ}خوام"}, golds=[], min_count=2) == {}

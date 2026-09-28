"""`gold_faithful.merge()`: agreement is taken, disagreement waits for a reviewer.

Nothing is resolved by picking a side mechanically, so a row the two families
disagree on and nobody has adjudicated is left out and listed, never guessed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training import gold_faithful  # noqa: E402

GOLD = [
    {"id": "gold-0001", "input": "agar biaayad", "expected": "اگه بیاد", "alternatives": []},
    {"id": "gold-0002", "input": "man miravam", "expected": "من میرم", "alternatives": []},
    {"id": "gold-0003", "input": "salam khoobi", "expected": "سلام خوبی", "alternatives": []},
]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


@pytest.fixture
def setup(tmp_path, monkeypatch):
    gold = tmp_path / "gold.jsonl"
    write_jsonl(gold, GOLD)
    monkeypatch.setattr(gold_faithful, "GOLD", gold)
    monkeypatch.setattr(gold_faithful, "FAITHFUL", tmp_path / "faithful.jsonl")
    monkeypatch.setattr(gold_faithful, "ADJUDICATIONS", tmp_path / "adjudications.jsonl")
    run = tmp_path / "run"
    run.mkdir()
    return tmp_path, run


def labels(**texts: str) -> list[dict]:
    return [{"id": rid.replace("_", "-"), "faithful": text} for rid, text in texts.items()]


def test_agreement_is_taken_and_disagreement_waits(setup):
    tmp, run = setup
    write_jsonl(run / "claude-0.jsonl", labels(gold_0001="اگر بیاید", gold_0002="من میروم", gold_0003="سلام خوبی"))
    # ي folds to ی under normalize, so this is agreement, not a disagreement.
    write_jsonl(run / "luna-0.jsonl", labels(gold_0001="اگر بيايد", gold_0002="من میرم", gold_0003="سلام خوبی"))
    gold_faithful.merge(run)

    out = {r["id"]: r for r in map(json.loads, (tmp / "faithful.jsonl").read_text(encoding="utf-8").splitlines())}
    assert set(out) == {"gold-0001", "gold-0003"}
    assert out["gold-0001"]["faithful"] == "اگر بیاید" and out["gold-0001"]["by"] == "both"
    pending = [json.loads(line) for line in (run / "to-adjudicate.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [p["id"] for p in pending] == ["gold-0002"]

    write_jsonl(tmp / "adjudications.jsonl", [{"id": "gold-0002", "faithful": "من میروم", "chose": "claude", "why": ""}])
    gold_faithful.merge(run)
    out = {r["id"]: r for r in map(json.loads, (tmp / "faithful.jsonl").read_text(encoding="utf-8").splitlines())}
    assert out["gold-0002"]["by"] == "adjudicated" and out["gold-0002"]["faithful"] == "من میروم"


def test_missing_and_unknown_rows_are_refused(setup):
    _, run = setup
    write_jsonl(run / "claude-0.jsonl", labels(gold_0001="اگر بیاید", gold_0002="من میرم"))
    write_jsonl(run / "luna-0.jsonl", labels(gold_0001="اگر بیاید", gold_0002="من میرم", gold_0003="سلام خوبی"))
    with pytest.raises(SystemExit, match="missing rows"):
        gold_faithful.merge(run)
    write_jsonl(run / "claude-0.jsonl", labels(gold_0001="اگر بیاید", gold_0002="من میرم", gold_0009="x"))
    with pytest.raises(SystemExit, match="unknown id"):
        gold_faithful.merge(run)


def test_an_added_half_space_is_refused(setup):
    _, run = setup
    both = labels(gold_0001="اگر بیاید", gold_0002="من می‌روم", gold_0003="سلام خوبی")
    write_jsonl(run / "claude-0.jsonl", both)
    write_jsonl(run / "luna-0.jsonl", both)
    with pytest.raises(SystemExit, match="refused"):
        gold_faithful.merge(run)

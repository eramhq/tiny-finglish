"""Python half of the cross-language normalizer parity check.

`data/fixtures/normalization.jsonl` is run by both this file and
`test/normalize.test.ts`. If the two implementations ever diverge, one of them
fails here and the other fails there.
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tiny_finglish_training.normalize import ZWNJ, fold_for_match, normalize  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CASES = [
    json.loads(line)
    for line in (ROOT / "data" / "fixtures" / "normalization.jsonl").read_text(encoding="utf-8").splitlines()
    if line
]


def test_fixtures_present():
    assert len(CASES) > 40


@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['group']}:{c['input'][:12]!r}")
def test_matches_committed_fixture(case):
    assert normalize(case["input"]) == case["output"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["group"])
def test_fold_matches_committed_fixture(case):
    assert fold_for_match(case["input"]) == case["fold"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["group"])
def test_idempotent(case):
    once = normalize(case["input"])
    assert normalize(once) == once


def test_idempotent_over_arabic_blocks():
    for cp in range(0x0600, 0x0700):
        probe = "ا" + chr(cp) + "ب"
        once = normalize(probe)
        assert normalize(once) == once, f"U+{cp:04X}"


def test_heh_hamza_is_the_nfc_stable_form():
    canonical = "هٔ"
    assert normalize("ۀ") == canonical
    assert normalize("ۀ") == canonical
    # U+06D5 U+0654 recomposes to the ISIRI-forbidden U+06C0 under NFC; the
    # canonical form must not.
    assert unicodedata.normalize("NFC", canonical) == canonical


def test_zwnj_meaning_preserved_in_display_collapsed_in_fold():
    assert normalize(f"تن{ZWNJ}ها") != normalize("تنها")
    assert fold_for_match(f"تن{ZWNJ}ها") == fold_for_match("تنها")

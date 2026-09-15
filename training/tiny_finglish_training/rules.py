"""Loader for ``data/rules/graphemes.json``.

That file is generated from ``src/rules.ts`` by ``scripts/export-rules.ts``.
TypeScript owns the table; this module only reads it, so the browser runtime
and the training corpus can never drift apart on what `kh` may mean.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

RULES_PATH = Path(__file__).resolve().parents[2] / "data" / "rules" / "graphemes.json"


@dataclass(frozen=True)
class Grapheme:
    fa: str
    latin: tuple[str, ...]
    pos: tuple[str, ...]
    role: str
    w: float
    latin_weights: tuple[float, ...] | None = None


@lru_cache(maxsize=1)
def load() -> dict:
    with RULES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def graphemes() -> tuple[Grapheme, ...]:
    data = load()
    all_positions = tuple(data["positions"])
    return tuple(
        Grapheme(
            fa=g["fa"],
            latin=tuple(g["latin"]),
            pos=tuple(g.get("pos", all_positions)),
            role=g["role"],
            w=float(g["w"]),
            latin_weights=tuple(g["latinWeights"]) if g.get("latinWeights") else None,
        )
        for g in data["graphemes"]
    )


@lru_cache(maxsize=1)
def latin_units() -> tuple[str, ...]:
    return tuple(load()["latinUnits"])


@lru_cache(maxsize=1)
def spellings_by_role() -> dict[tuple[str, str], tuple[tuple[str, ...], tuple[float, ...] | None]]:
    """(persian grapheme, role) -> (spellings, weights).

    Keyed by role because و and ی each serve as both consonant and vowel, and
    drawing from the wrong table is the difference between `emrooz` and `emrvz`.

    Weights, where present, are measured from real human-written Finglish. See
    the `latinWeights` docstring in ``src/rules.ts``.
    """
    out: dict[tuple[str, str], tuple[tuple[str, ...], tuple[float, ...] | None]] = {}
    for g in graphemes():
        key = (g.fa, g.role)
        if key in out:
            continue
        out[key] = (g.latin, g.latin_weights)
    return out

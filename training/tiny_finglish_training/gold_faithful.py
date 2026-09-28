"""Give every gold row a `faithful` reference, made the way dev's was.

Gold's `expected` is the Common Voice sentence. The typist often typed another
register of it — formal `mishavad` over colloquial `میشه` — and no
transliterator can recover the colloquial form from the formal typing. A
number against `expected` alone therefore mixes accuracy with register. Dev
already measures around this with `faithful`: the reference minimally edited
to what was typed (see `build_dev.py`). This file makes the same reference for
gold, with the same rules, so the two are comparable.

**This is LLM labour, two model families, recorded.** Each row goes to a
Claude subagent and to Codex luna, which see only `input` and `expected` and
never an engine's output, and return one `faithful` string under
`data/provenance/prompts/gold-faithful.md` — the `faithful` rules of
`dev-repair.md`, word for word, without the verdict and span steps: gold rows
are already audited as aligned (`data/gold/audit.jsonl`). Where the two
normalized strings are identical the text is taken; every other row must have
an entry in `data/gold/faithful-adjudications.jsonl`, written by a blind third
reviewer, or it is listed and left out.

The result is `data/gold/faithful.jsonl`, keyed by `rowSha` like the audit, not
a field written into `gold.jsonl` directly: `build_gold.py` rewrites that file
and would drop the field. `scripts/split-gold.ts` attaches it.

    python -m tiny_finglish_training.gold_faithful --export runs/llm/gold-faithful --shards 8
    # ... writers produce runs/llm/gold-faithful/{claude,luna}-K.jsonl ...
    python -m tiny_finglish_training.gold_faithful --merge runs/llm/gold-faithful
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .build_dev import FAMILIES, row_sha
from .normalize import normalize

ROOT = Path(__file__).resolve().parents[2]
GOLD = ROOT / "data" / "gold" / "gold.jsonl"
FAITHFUL = ROOT / "data" / "gold" / "faithful.jsonl"
ADJUDICATIONS = ROOT / "data" / "gold" / "faithful-adjudications.jsonl"

ZWNJ = "‌"


def gold_rows() -> list[dict]:
    return [json.loads(line) for line in GOLD.read_text(encoding="utf-8").splitlines() if line]


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def export(out_dir: Path, shards: int) -> None:
    rows = gold_rows()
    out_dir.mkdir(parents=True, exist_ok=True)
    for k in range(shards):
        shard = rows[k::shards]
        path = out_dir / f"shard-{k}.jsonl"
        path.write_text("".join(
            json.dumps({"id": r["id"], "input": r["input"], "expected": r["expected"]}, ensure_ascii=False) + "\n"
            for r in shard), encoding="utf-8")
        print(f"{path}  {len(shard)} rows  sha256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    print(f"{len(rows)} gold rows in {shards} shards")


def problem(faithful: str, expected: str) -> str | None:
    """Why a faithful text cannot be used, or None. Takes the normalized text."""
    if not faithful.strip():
        return "empty"
    if ZWNJ in faithful and ZWNJ not in expected:
        return "adds U+200C"
    if any(ch in faithful for ch in "يك"):
        return "Arabic ي/ك"
    return None


def merge(run_dir: Path) -> None:
    """Combine the two families' texts into `faithful.jsonl`.

    Identical normalized text is taken as-is. Anything else needs a row in
    `faithful-adjudications.jsonl`; until it has one it is written to
    `to-adjudicate.jsonl` and left out. Nothing is resolved by picking a side
    mechanically.
    """
    rows = gold_rows()
    ids = {r["id"] for r in rows}
    texts: dict[str, dict[str, str]] = {family: {} for family in FAMILIES}
    for family in FAMILIES:
        for path in sorted(run_dir.glob(f"{family}-*.jsonl")):
            for label in read_jsonl(path):
                if label["id"] not in ids:
                    raise SystemExit(f"{path.name}: unknown id {label['id']}")
                if label["id"] in texts[family]:
                    raise SystemExit(f"{path.name}: duplicate id {label['id']}")
                texts[family][label["id"]] = label["faithful"]
    missing = {family: sorted(ids - texts[family].keys()) for family in FAMILIES}
    if any(missing.values()):
        raise SystemExit("missing rows: " + json.dumps({f: m[:10] + (["..."] if len(m) > 10 else [])
                                                        for f, m in missing.items() if m}))
    adjudicated = {a["id"]: a for a in read_jsonl(ADJUDICATIONS)} if ADJUDICATIONS.exists() else {}

    out, pending, bad = [], [], []
    counts = {"both": 0, "adjudicated": 0, "pending": 0, "bothUnchanged": 0}
    for row in rows:
        proposals = {family: normalize(texts[family][row["id"]]) for family in FAMILIES}
        if proposals["claude"] == proposals["luna"]:
            faithful, by = proposals["claude"], "both"
            counts["bothUnchanged"] += faithful == row["expected"]
        elif row["id"] in adjudicated:
            faithful, by = normalize(adjudicated[row["id"]]["faithful"]), "adjudicated"
        else:
            counts["pending"] += 1
            pending.append({"id": row["id"], "source": {"input": row["input"], "expected": row["expected"]},
                            **proposals})
            continue
        why = problem(faithful, row["expected"])
        if why:
            bad.append(f"{row['id']} ({by}): {why}: {faithful}")
            continue
        counts[by] += 1
        out.append({"id": row["id"], "rowSha": row_sha(row["input"], row["expected"]), "faithful": faithful,
                    "proposals": proposals, "by": by})

    todo = run_dir / "to-adjudicate.jsonl"
    todo.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in pending), encoding="utf-8")
    if bad:
        print("\n".join(bad))
        raise SystemExit(f"{len(bad)} faithful texts refused; fix the proposals or the adjudications")
    FAITHFUL.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in out), encoding="utf-8")
    by_id = {r["id"]: r for r in rows}
    differs = sum(r["faithful"] != by_id[r["id"]]["expected"] for r in out)
    print(json.dumps({"rows": len(rows), "written": len(out), **counts, "faithfulDiffersFromExpected": differs,
                      "sha256": hashlib.sha256(FAITHFUL.read_bytes()).hexdigest()}, indent=2))
    print(f"to adjudicate: {todo} ({len(pending)})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--export", type=Path, help="write gold shards for the two writers here")
    parser.add_argument("--shards", type=int, default=8)
    parser.add_argument("--merge", type=Path, help="merge the writers' texts in this directory into faithful.jsonl")
    args = parser.parse_args()
    if args.export:
        export(args.export, args.shards)
    elif args.merge:
        merge(args.merge)
    else:
        parser.error("pass --export or --merge")


if __name__ == "__main__":
    main()

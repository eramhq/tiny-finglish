"""Build the development set: real human Finglish that the gold build threw away.

The gold rules say nothing is tuned on `data/gold/`. Until now that left the
fixtures — 194 author-written cases — as the only tuning surface, and a surface
that small and that close to the rule table cannot see most of what goes wrong
on real typing. This file is a second real surface, disjoint from gold.

Source: the same repository as gold (mmahdibarghi/finglish-dataset, MIT; Persian
side from Common Voice, CC0), read through the same `collect_pairs`. Of its
2,769 unique pairs the gold build keeps 1,906 and **drops 863** — 826 on the
word-count filter, 25 on length, 12 on charset. Many of those are not bad pairs:
a filter that allows a one-word difference rejects `oon zan yek joor haei lokht
ast` against `اون زنه یه جورایی لخته` for splitting `haei` off its stem. Many
others really are two different sentences. No filter separates the two, which
is why the labels come from a repair pass rather than a threshold.

**The repair pass is LLM labour, two model families, recorded.** Each candidate
goes to a Claude subagent and to Codex GPT-5.6 luna, which see only the two
sides of the row and never an engine's output, and return a verdict — aligned,
trimmable, misaligned — plus the aligned word spans and a *faithful* reference.
Merged verdicts, with disagreements adjudicated, are committed as
`data/dev/repairs.jsonl`; the prompt text and shard hashes are recorded in
`data/provenance/dev.json`. This script only ever applies that file, and checks
every span it applies is a contiguous word span of the source row, so a judge
can cut a row but never rewrite one.

Two references per row, because the source has two kinds of truth:

  * `expected` — the Common Voice sentence, trimmed to the aligned span.
  * `faithful` — the same sentence minimally edited to what was actually typed.
    Input `agar`, reference `اگه`: `expected` keeps `اگه`, `faithful` has
    `اگر`. No transliterator can recover the colloquial form from the formal
    typing, so a number against `expected` alone mixes accuracy with register.

Disjointness from gold is checked, not assumed: a row whose Finglish or whose
folded Persian matches either gold file is excluded. Corpus builders exclude
dev sentences through `load_gold_keys`, like gold, so a table tuned against dev
was never counted over it.

    python -m tiny_finglish_training.build_dev --export runs/llm/dev --shards 4
    # ... judges write runs/llm/dev/{claude,luna}-K.jsonl ...
    python -m tiny_finglish_training.build_dev --merge runs/llm/dev   # -> repairs.jsonl + a to-adjudicate list
    python -m tiny_finglish_training.build_dev
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .build_gold import collect_pairs, drop_reason
from .normalize import fold_for_match, normalize

ROOT = Path(__file__).resolve().parents[2]
GOLDS = [ROOT / "data" / "gold" / "gold.jsonl", ROOT / "data" / "gold" / "gold-misaligned.jsonl"]
REPAIRS = ROOT / "data" / "dev" / "repairs.jsonl"
ADJUDICATIONS = ROOT / "data" / "dev" / "adjudications.jsonl"
FAMILIES = ("claude", "luna")
DEV = ROOT / "data" / "dev" / "dev.jsonl"
PROVENANCE = ROOT / "data" / "provenance" / "dev.json"

MIN_WORDS = 2


def row_sha(finglish: str, persian: str) -> str:
    """Identity of a candidate's content. A repair keyed to stale content is refused."""
    return hashlib.sha256(f"{finglish}\t{persian}".encode("utf-8")).hexdigest()[:16]


def candidates() -> tuple[list[dict], dict]:
    """The rows the gold build drops, minus anything that overlaps gold."""
    pairs, raw_rows = collect_pairs()
    gold_inputs: set[str] = set()
    gold_keys: set[str] = set()
    for gold in GOLDS:
        for line in gold.read_text(encoding="utf-8").splitlines():
            if line:
                row = json.loads(line)
                gold_inputs.add(row["input"].lower())
                gold_keys.add(fold_for_match(row["expected"]))

    rows, reasons, overlap = [], {"misaligned": 0, "length": 0, "charset": 0}, 0
    for finglish, persian in sorted(pairs.items()):
        reason = drop_reason(finglish, persian)
        if reason is None:
            continue
        if finglish in gold_inputs or fold_for_match(persian) in gold_keys:
            overlap += 1
            continue
        reasons[reason] += 1
        rows.append({
            "id": f"dev-{row_sha(finglish, persian)[:10]}",
            "rowSha": row_sha(finglish, persian),
            "dropReason": reason,
            "input": finglish,
            "expected": persian,
        })
    return rows, {"rawRows": raw_rows, "uniquePairs": len(pairs), "candidates": len(rows),
                  "candidateReasons": reasons, "excludedAsGoldOverlap": overlap}


def export(out_dir: Path, shards: int) -> None:
    rows, stats = candidates()
    out_dir.mkdir(parents=True, exist_ok=True)
    for k in range(shards):
        shard = rows[k::shards]
        path = out_dir / f"shard-{k}.jsonl"
        path.write_text("".join(
            json.dumps({"id": r["id"], "input": r["input"], "expected": r["expected"]}, ensure_ascii=False) + "\n"
            for r in shard), encoding="utf-8")
        print(f"{path}  {len(shard)} rows  sha256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")
    print(json.dumps(stats, indent=2))


def word_span(whole: str, part: str) -> bool:
    """True when `part` is a contiguous run of `whole`'s whitespace-separated words."""
    w, p = whole.split(), part.split()
    return bool(p) and any(w[i:i + len(p)] == p for i in range(len(w) - len(p) + 1))


def merge(judge_dir: Path) -> None:
    """Combine the two families' labels into `repairs.jsonl`.

    Agreement is taken as-is. Anything the families disagree on — the verdict,
    the spans, or the faithful text — must have a row in `adjudications.jsonl`,
    written by a reviewer who read the source row and both proposals; until it
    does, the row is listed and left out. Nothing is resolved by picking a side
    mechanically.
    """
    rows, _ = candidates()
    labels: dict[str, dict[str, dict]] = {family: {} for family in FAMILIES}
    for family in FAMILIES:
        for path in sorted(judge_dir.glob(f"{family}-*.jsonl")):
            for line in path.read_text(encoding="utf-8").splitlines():
                if line:
                    label = json.loads(line)
                    labels[family][label["id"]] = label
    adjudicated = {}
    if ADJUDICATIONS.exists():
        adjudicated = {a["id"]: a for a in map(json.loads, ADJUDICATIONS.read_text(encoding="utf-8").splitlines()) if a}

    def text(label: dict) -> tuple:
        if label["verdict"] == "misaligned":
            return ("misaligned",)
        return ("kept", label["input"], normalize(label["expected"]), normalize(label["faithful"]))

    repairs, pending, agreement = [], [], {"both": 0, "adjudicated": 0, "verdictOnly": 0, "textOnly": 0}
    for row in rows:
        a, b = labels["claude"].get(row["id"]), labels["luna"].get(row["id"])
        if a is None or b is None:
            continue
        verdicts = {"claude": a["verdict"], "luna": b["verdict"]}
        if text(a) == text(b):
            chosen, by = a, "both"
        elif row["id"] in adjudicated:
            chosen, by = adjudicated[row["id"]], "adjudicated"
        else:
            kept_a, kept_b = a["verdict"] != "misaligned", b["verdict"] != "misaligned"
            agreement["verdictOnly" if kept_a != kept_b else "textOnly"] += 1
            pending.append({"id": row["id"], "source": {"input": row["input"], "expected": row["expected"]},
                            "claude": a, "luna": b})
            continue
        agreement[by] += 1
        kept = chosen["verdict"] != "misaligned"
        repairs.append({
            "id": row["id"], "rowSha": row["rowSha"], "verdict": chosen["verdict"],
            "input": chosen["input"] if kept else "", "expected": normalize(chosen["expected"]) if kept else "",
            "faithful": normalize(chosen["faithful"]) if kept else "", "verdicts": verdicts, "by": by,
        })

    REPAIRS.parent.mkdir(parents=True, exist_ok=True)
    REPAIRS.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in repairs), encoding="utf-8")
    todo = judge_dir / "to-adjudicate.jsonl"
    todo.write_text("".join(json.dumps(p, ensure_ascii=False) + "\n" for p in pending), encoding="utf-8")
    print(json.dumps({"repairs": len(repairs), "pending": len(pending), **agreement}, indent=2))
    print(f"to adjudicate: {todo}")


def build() -> dict:
    rows, stats = candidates()
    by_id = {r["id"]: r for r in rows}
    repairs = [json.loads(line) for line in REPAIRS.read_text(encoding="utf-8").splitlines() if line]

    kept, verdicts, refused, too_short = [], {"aligned": 0, "trimmable": 0, "misaligned": 0}, [], 0
    for repair in repairs:
        source = by_id.get(repair["id"])
        if source is None or source["rowSha"] != repair["rowSha"]:
            refused.append((repair["id"], "stale: source row changed or vanished"))
            continue
        verdicts[repair["verdict"]] += 1
        if repair["verdict"] == "misaligned":
            continue
        finglish, persian, faithful = repair["input"], repair["expected"], repair["faithful"]
        if not word_span(source["input"], finglish):
            refused.append((repair["id"], "input is not a word span of the source"))
        elif not word_span(source["expected"], persian):
            refused.append((repair["id"], "expected is not a word span of the source"))
        elif normalize(persian) != persian or normalize(faithful) != faithful:
            refused.append((repair["id"], "reference not normalized"))
        elif len(finglish.split()) < MIN_WORDS:
            # A filter, not a defect: gold applies the same minimum.
            too_short += 1
        else:
            # `source` is the untrimmed sentence, for the corpus builders'
            # leakage guard: HomoRich holds the whole sentence, not the span.
            kept.append({"id": repair["id"], "input": finglish, "expected": persian,
                         "faithful": faithful, "alternatives": [], "source": source["expected"]})

    if refused:
        for rid, why in refused:
            print(f"refused {rid}: {why}")
        raise SystemExit(f"{len(refused)} repairs refused; fix data/dev/repairs.jsonl first")

    unrepaired = len(rows) - len(repairs)
    kept.sort(key=lambda r: r["id"])
    DEV.parent.mkdir(parents=True, exist_ok=True)
    DEV.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()  # noqa: E731
    return {**stats, "repaired": len(repairs), "unrepaired": unrepaired, "verdicts": verdicts,
            "droppedUnderMinWords": too_short, "kept": len(kept), "sha256": sha(DEV), "repairsSha256": sha(REPAIRS)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--export", type=Path, help="write candidate shards for the repair pass here")
    parser.add_argument("--shards", type=int, default=4)
    parser.add_argument("--merge", type=Path, help="merge the judges' labels in this directory into repairs.jsonl")
    args = parser.parse_args()
    if args.export:
        export(args.export, args.shards)
        return
    if args.merge:
        merge(args.merge)
        return
    manifest = build()
    existing = json.loads(PROVENANCE.read_text(encoding="utf-8")) if PROVENANCE.exists() else {}
    # The judging record (models, prompt hashes, shard hashes, agreement) is
    # written by hand when repairs.jsonl is merged; this script owns the counts.
    PROVENANCE.write_text(json.dumps({
        "$comment": "Counts GENERATED by training/tiny_finglish_training/build_dev.py; `repairPass` recorded at merge time.",
        "source": "https://github.com/mmahdibarghi/finglish-dataset",
        "sourceLicense": "MIT",
        "persianSideOrigin": "Mozilla Common Voice Persian (CC0)",
        **{k: v for k, v in existing.items() if k == "repairPass"},
        **manifest,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

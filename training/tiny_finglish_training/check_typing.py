"""Accept or reject a typist's shard before it reaches the corpus.

The persona cards in ``build_distill.py`` are calibrated to the dev set's
measured human rates, and version 1 of those cards was thrown away precisely
because caricatures that miss the rates produce a corpus further from real
typing than a smaller honest one. That calibration is worth nothing if nobody
checks the output against it, and the first shard of the third round showed why:
36% of its sentence pairs were byte-identical between the two personas and
`everyday` typed `aa` 41.7 times per 100 words against a target of 15.

So this measures what the cards promise, per worker file and over the round:

    python -m tiny_finglish_training.check_typing runs/llm/distill
    python -m tiny_finglish_training.check_typing runs/llm/distill --first 69

Reference rates are the human's, measured on the dev set by `scripts/fidelity.ts`
and recorded in data/provenance/distill.json: `aa` 18.4 per 100 words and 10.8
detached affix pieces per 100 words. `everyday` is meant to sit near the first
and `careful` well above it.

**The round aggregate is the gate; per-file bands only find files to re-type.**
Per-file rates vary enormously in the corpus that shipped and average out, so
the aggregate is the number the persona cards were calibrated against and the
one that decides. Run it with `--first <n>` to judge one round on its own, and
re-dispatch the files it names. Exit status is 1 when the round is rejected, so
a dispatch loop can gate on it.
"""

from __future__ import annotations

import argparse
import collections
import json
from pathlib import Path

#: Per-file bands, per 100 words, by persona. **Calibrated from the corpus that
#: shipped**, not from the cards' prose: over the 69 worker files behind
#: v6 the per-file spread is enormous and averages out, so a tight per-file band
#: would reject honest variation. These are the shipped p5-p95 rounded outward,
#: so they catch a file that is grossly off and nothing else.
#:
#:     persona   habit      p5    p50    p95
#:     everyday  aa        2.6   18.8   39.9
#:     everyday  detached  7.3   11.6   20.1
#:     careful   aa       14.8   39.6   47.3
#:     careful   detached  0.0    0.5    2.1
#:
#: `careful detached` sits near zero because the card only has that persona
#: detaching `haa` sometimes; an early version of this file guessed 2-16 from the
#: prose and failed every shipped shard, which is why the numbers here come from
#: the data instead.
BANDS = {
    "everyday": {"aa": (2.0, 42.0), "detached": (5.0, 22.0)},
    "careful": {"aa": (8.0, 50.0), "detached": (0.0, 5.0)},
}

#: What the *round* has to hit, which is the figure the persona cards were
#: calibrated against. Aggregates are stable where single files are not, so this
#: is the check that matters. The human's dev-set rates are aa 18.4 and 10.8
#: detached per 100 words; the shipped corpus sits at everyday 19.8/12.7 and
#: careful 36.5/0.7.
AGGREGATE = {
    "everyday": {"aa": (13.0, 27.0), "detached": (8.0, 18.0)},
    "careful": {"aa": (28.0, 48.0), "detached": (0.0, 3.0)},
}

#: Most sentences must be typed differently by the two personas, which differ on
#: the long-ا habit above all. Identical output across both means the worker
#: typed once and copied, which silently halves the shard. The shipped corpus
#: runs at 9.0% aggregate and never exceeds 31% in a single file.
MAX_IDENTICAL_SHARE = 0.32
MAX_IDENTICAL_SHARE_ROUND = 0.15

#: How many individual files may miss their band before the round is rejected.
#: The shipped corpus has 4 of 69 outside `BANDS` — three workers who essentially
#: never typed `aa` and one who typed almost nothing else — and it produced a
#: model at 70.5% gold, so a handful of odd files is survivable and the aggregate
#: is what decides. Beyond this share the round is not a few odd workers any more.
MAX_FAILED_FILE_SHARE = 0.10


def rates(words: list[str]) -> dict[str, float]:
    n = len(words)
    if not n:
        return {"words": 0, "aa": 0.0, "detached": 0.0}
    return {
        "words": n,
        "aa": 100 * sum(w.count("aa") for w in words) / n,
        "detached": 100 * sum(1 for w in words if " " in w) / n,
    }


def check_file(path: Path) -> tuple[bool, list[str], dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    problems: list[str] = []
    by_sentence: dict[str, dict[str, list[str]]] = collections.defaultdict(dict)
    by_persona: dict[str, list[str]] = collections.defaultdict(list)
    for row in rows:
        by_sentence[row["id"]][row["persona"]] = row["finglish"]
        by_persona[row["persona"]].extend(row["finglish"])

    both = [v for v in by_sentence.values() if len(v) == len(BANDS)]
    identical = sum(1 for v in both if len({tuple(f) for f in v.values()}) == 1)
    share = identical / len(both) if both else 0.0
    if share > MAX_IDENTICAL_SHARE:
        problems.append(f"{identical}/{len(both)} sentence pairs identical across personas "
                        f"({100 * share:.0f}% > {100 * MAX_IDENTICAL_SHARE:.0f}%)")

    measured = {}
    for persona, bands in BANDS.items():
        words = by_persona.get(persona)
        if not words:
            problems.append(f"no {persona} lines")
            continue
        measured[persona] = rates(words)
        for habit, (low, high) in bands.items():
            value = measured[persona][habit]
            if not low <= value <= high:
                problems.append(f"{persona} {habit} {value:.1f}/100w outside {low:.0f}-{high:.0f}")

    return not problems, problems, {"lines": len(rows), "sentences": len(by_sentence),
                                    "identicalShare": round(share, 3), "rates": measured,
                                    "words": dict(by_persona), "both": len(both),
                                    "identical": identical}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--worker", default="*", help="worker name prefix; default every worker")
    parser.add_argument("--quiet", action="store_true", help="print failures only")
    parser.add_argument("--first", type=int, default=None,
                        help="lowest shard number to check, for gating one round on its own")
    args = parser.parse_args()

    paths = sorted(args.directory.glob(f"{args.worker}-gen-*.jsonl"),
                   key=lambda p: int(p.stem.split("-gen-")[1]))
    if args.first is not None:
        paths = [p for p in paths if int(p.stem.split("-gen-")[1]) >= args.first]
    if not paths:
        raise SystemExit(f"no worker files matching {args.worker}-gen-*.jsonl in {args.directory}")

    failed = []
    pooled: dict[str, list[str]] = collections.defaultdict(list)
    pooled_both = pooled_identical = 0
    for path in paths:
        ok, problems, stats = check_file(path)
        if not ok:
            failed.append(path.name)
        for persona, words in stats["words"].items():
            pooled[persona].extend(words)
        pooled_both += stats["both"]
        pooled_identical += stats["identical"]
        if args.quiet and ok:
            continue
        mark = "ok  " if ok else "FAIL"
        summary = "  ".join(
            f"{persona[:4]} aa {r['aa']:.1f} det {r['detached']:.1f}"
            for persona, r in stats["rates"].items())
        print(f"{mark} {path.name:24} {stats['lines']:4} lines  {stats['sentences']:4} sentences  "
              f"identical {100 * stats['identicalShare']:3.0f}%  {summary}")
        for problem in problems:
            print(f"       - {problem}")

    print(f"\n-- round aggregate over {len(paths)} file(s) --")
    round_problems = []
    share = pooled_identical / pooled_both if pooled_both else 0.0
    print(f"identical persona pairs {pooled_identical}/{pooled_both} ({100 * share:.1f}%), "
          f"limit {100 * MAX_IDENTICAL_SHARE_ROUND:.0f}%")
    if share > MAX_IDENTICAL_SHARE_ROUND:
        round_problems.append(f"round identical share {100 * share:.1f}% over "
                              f"{100 * MAX_IDENTICAL_SHARE_ROUND:.0f}%")
    for persona, bands in AGGREGATE.items():
        r = rates(pooled.get(persona, []))
        print(f"{persona:9} words {r['words']:6}  aa/100w {r['aa']:5.1f}  detached/100w {r['detached']:5.1f}")
        for habit, (low, high) in bands.items():
            if not low <= r[habit] <= high:
                round_problems.append(f"round {persona} {habit} {r[habit]:.1f}/100w "
                                      f"outside {low:.0f}-{high:.0f}")
    for problem in round_problems:
        print(f"  - {problem}")

    failed_share = len(failed) / len(paths)
    print(f"files outside their band {len(failed)}/{len(paths)} ({100 * failed_share:.1f}%), "
          f"limit {100 * MAX_FAILED_FILE_SHARE:.0f}%")
    if failed:
        print(f"  re-dispatch: {', '.join(failed)}")
    if round_problems or failed_share > MAX_FAILED_FILE_SHARE:
        raise SystemExit("typing rejected")
    print("typing accepted")


if __name__ == "__main__":
    main()

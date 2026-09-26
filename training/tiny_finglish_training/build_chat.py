"""The chat sets: an AI-typed chat test set, and the chat lines a typing round trains on.

Nothing measured chat before this. Gold and dev are read-aloud sentences, and
under 5% of them look like texting, while users of a Finglish converter mostly
type chat. So this builds two things from LLM-written Persian chat messages,
every line reviewed by two model families (Claude and luna) and kept only when
both accept it (`data/provenance/prompts/chat-review.md`):

  * **the test set**, 300 messages written from their own scenes and prompt
    (`chat-test-write.md`), typed in Finglish by Claude with the `texting`
    persona (`chat-typing.md`), and split by message hash into
    `data/chat/chat-dev.jsonl` (200, the chat tuning surface) and
    `data/chat/chat-test.jsonl` (100, scored once, at the end, like gold);
  * **the training lines**, `data/chat/chat-lines.jsonl`, written from other
    topics (`chat-write.md`) and typed later by luna with the training personas.

**Every number scored on these sets is AI-typed.** LLM typing converts 10-17
points easier than human typing of the same sentences (docs/llm-work.md §5),
so read chat numbers as differences between engines, never as absolutes. The
test set's typist is a different family and persona from the training data's
for the same reason.

    python -m tiny_finglish_training.build_chat --select      # reviewed test messages -> typing shards
    python -m tiny_finglish_training.build_chat --assemble    # typed shards -> chat-dev / chat-test
    python -m tiny_finglish_training.build_chat --lines       # reviewed training lines -> chat-lines.jsonl

The training side is excluded from the test side twice: chat-dev and
chat-test are in `EVALUATION_FILES`, so `build_distill.sample` drops any line
whose words are a test message or that shares four words running with one.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from .build_frequency import leak_key

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "training" / "runs" / "llm" / "chat"
CHAT = ROOT / "data" / "chat"
PROMPTS = ROOT / "data" / "provenance" / "prompts"
PROVENANCE = ROOT / "data" / "provenance" / "chat.json"
ZWNJ = "‌"

#: How many test messages, and how many of those are held out as chat-test.
SIZE = 300
HELD_OUT_EVERY = 3


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verdicts(letters: str) -> dict[str, tuple[str, str]]:
    """id -> (claude verdict, luna verdict), over the review shards `letters`."""
    out: dict[str, tuple[str, str]] = {}
    for letter in letters:
        claude = {r["id"]: r["verdict"] for r in read_jsonl(WORK / f"claude-review-{letter}.jsonl")}
        luna = {r["id"]: r["verdict"] for r in read_jsonl(WORK / f"luna-review-{letter}.jsonl")}
        for row in read_jsonl(WORK / f"review-in-{letter}.jsonl"):
            out[row["id"]] = (claude.get(row["id"], "missing"), luna.get(row["id"], "missing"))
    return out


def accepted(letters: str) -> tuple[list[dict], dict[str, int]]:
    """Rows both families accept, first spelling of each word key kept, and the tally."""
    votes = verdicts(letters)
    tally = {"both": 0, "claudeOnly": 0, "lunaOnly": 0, "neither": 0, "duplicate": 0}
    kept: list[dict] = []
    seen: set[str] = set()
    for letter in letters:
        for row in read_jsonl(WORK / f"review-in-{letter}.jsonl"):
            claude, luna = votes[row["id"]]
            if claude == "accept" and luna == "accept":
                key = leak_key(row["text"])
                if key in seen:
                    tally["duplicate"] += 1
                    continue
                seen.add(key)
                tally["both"] += 1
                kept.append(row)
            elif claude == "accept":
                tally["claudeOnly"] += 1
            elif luna == "accept":
                tally["lunaOnly"] += 1
            else:
                tally["neither"] += 1
    return kept, tally


def message_hash(row: dict) -> str:
    return hashlib.sha256(leak_key(row["text"]).encode()).hexdigest()


def reference(row: dict) -> tuple[str, list[str]]:
    """The gold convention: no ZWNJ in the reference; a ZWNJ spelling is an alternative."""
    text = row["text"].strip()
    alternatives = [a.strip() for a in row.get("alternatives", []) if a.strip()]
    if ZWNJ in text:
        alternatives = [text, *alternatives]
        text = text.replace(ZWNJ, "")
    alternatives = list(dict.fromkeys(a for a in alternatives if a != text))
    return text, alternatives


def select(shards: int) -> None:
    """Pick the `SIZE` messages by hash order and write them out for the typists."""
    kept, tally = accepted("cd")
    lines = {leak_key(r["text"]) for r in accepted("ab")[0]}
    ordered = sorted(kept, key=message_hash)
    chosen = ordered[:SIZE]
    rows = [{"id": r["id"], "text": reference(r)[0]} for r in chosen]
    for k in range(shards):
        write_jsonl(WORK / f"type-in-{k}.jsonl", rows[k::shards])
    overlap = sum(1 for r in chosen if leak_key(r["text"]) in lines)
    print(json.dumps({"review": tally, "chosen": len(chosen), "shards": shards,
                      "sameWordsAsATrainingLine": overlap}, indent=2))


def assemble() -> None:
    """Typed shards -> chat-dev.jsonl and chat-test.jsonl, split by message hash."""
    messages = {r["id"]: r for letter in "cd" for r in read_jsonl(WORK / f"review-in-{letter}.jsonl")}
    typed: dict[str, str] = {}
    shards = sorted(WORK.glob("type-in-*.jsonl"))
    for path in shards:
        out = WORK / path.name.replace("type-in-", "typed-")
        ids = [r["id"] for r in read_jsonl(path)]
        rows = {r["id"]: r["finglish"] for r in read_jsonl(out)}
        missing = [i for i in ids if i not in rows]
        if missing:
            raise SystemExit(f"{out.name}: {len(missing)} messages untyped, e.g. {missing[:3]}")
        typed.update({i: rows[i] for i in ids})
    ordered = sorted((messages[i] for i in typed), key=message_hash)
    dev, test = [], []
    for k, row in enumerate(ordered):
        text, alternatives = reference(row)
        fixture = {"id": row["id"], "category": "chat", "input": typed[row["id"]].strip(),
                   "expected": text, "alternatives": alternatives, "typedBy": "llm",
                   "scene": row.get("scene", "")}
        (test if k % HELD_OUT_EVERY == HELD_OUT_EVERY - 1 else dev).append(fixture)
    write_jsonl(CHAT / "chat-dev.jsonl", dev)
    write_jsonl(CHAT / "chat-test.jsonl", test)
    record("test", {
        "review": accepted("cd")[1],
        "chatDev": {"file": "data/chat/chat-dev.jsonl", "rows": len(dev), "sha256": sha(CHAT / "chat-dev.jsonl")},
        "chatTest": {"file": "data/chat/chat-test.jsonl", "rows": len(test), "sha256": sha(CHAT / "chat-test.jsonl")},
        "split": f"sha256 of the message's leak_key, ascending; every {HELD_OUT_EVERY}rd to chat-test",
        "typedShards": {p.name.replace('type-in-', 'typed-'): sha(WORK / p.name.replace('type-in-', 'typed-'))[:16]
                        for p in shards},
    })
    print(f"chat-dev {len(dev)}  chat-test {len(test)}")


def lines() -> None:
    """Reviewed training lines -> data/chat/chat-lines.jsonl."""
    kept, tally = accepted("ab")
    rows = [{"id": r["id"], "topic": r.get("topic", ""), "text": r["text"].strip()} for r in kept]
    write_jsonl(CHAT / "chat-lines.jsonl", rows)
    record("lines", {"file": "data/chat/chat-lines.jsonl", "rows": len(rows), "review": tally,
                     "sha256": sha(CHAT / "chat-lines.jsonl")})
    print(json.dumps({"lines": len(rows), "review": tally}, indent=2))


#: Who did what, for the provenance file. Both families are recorded because a
#: line counts only when both accepted it.
WORKERS = {
    "writers": "Claude Opus 5.5 in-session subagents: 4 wrote the training lines (chat-write.md, 260 each), "
               "2 wrote the test messages (chat-test-write.md, 192 each), from disjoint topics and scenes",
    "reviewers": "every line reviewed by a separate Claude Opus 5.5 subagent and by Codex CLI gpt-5.6-luna "
                 "(reasoning xhigh, herdr panes) with chat-review.md; kept only when both accept",
    "testTypist": "Claude Opus 5.5 in-session subagents, the `texting` persona (chat-typing.md), 3 shards of 100",
    "trainingTypists": "Codex CLI gpt-5.6-luna (reasoning xhigh), the everyday/careful personas of "
                       "distill-generate.md v2, shards 138-149 of runs/llm/distill",
}
PROMPT_FILES = ("chat-write.md", "chat-test-write.md", "chat-review.md", "chat-typing.md")


def record(section: str, data: dict) -> None:
    provenance = json.loads(PROVENANCE.read_text(encoding="utf-8")) if PROVENANCE.exists() else {}
    provenance.update({
        "$comment": "GENERATED by training/tiny_finglish_training/build_chat.py. Every chat-dev and "
                    "chat-test number is AI-typed: read differences between engines, not absolutes.",
        "date": "2026-09-26",
        "license": "CC0-1.0: the Persian lines and their typing are this project's own LLM output",
        "workers": WORKERS,
        "prompts": {name: sha(PROMPTS / name) for name in PROMPT_FILES},
        **provenance,
    })
    provenance[section] = data
    PROVENANCE.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--select", action="store_true")
    parser.add_argument("--assemble", action="store_true")
    parser.add_argument("--lines", action="store_true")
    parser.add_argument("--shards", type=int, default=3)
    args = parser.parse_args()
    if args.select:
        select(args.shards)
    elif args.assemble:
        assemble()
    elif args.lines:
        lines()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

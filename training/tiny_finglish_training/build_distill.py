"""LLM-typed Finglish: sample Persian sentences, have LLM "typists" romanize them, merge.

The synthetic corpus in ``g2p.py`` writes Finglish from rules, and the model
trained on it learned the rules: it scores 51% on real typing against the rule
baseline's 62%. Research on other scripts (Google, 2025) found that synthetic
romanizations which *sample natural variation* beat real data. No study
measures LLM-written romanization against human typing for Persian, so this
module does both halves: generate it, and test it against the dev set's human
typing before any of it is used.

    # 3.2 fidelity: LLM typists romanize the dev set's own Persian
    python -m tiny_finglish_training.build_distill --export-fidelity runs/llm/fidelity --shards 4
    # 3.1 pilot: HomoRich sentences, gold and dev excluded by the shared guard
    python -m tiny_finglish_training.build_distill --export runs/llm/distill --sentences 3000 --shards 20
    python -m tiny_finglish_training.build_distill --merge runs/llm/distill

Every worker gets whitespace-split Persian words and returns one Finglish
string per word, so word pairs come out aligned without an aligner. A string
may contain a space — `mi konam`, `ketaab haa` — because real typists detach
affixes, and a corpus that never does is not a corpus of real typing.

Source: HomoRich (CC0-1.0), the same file the frequency table is built from,
through ``load_gold_keys(*EVALUATION_FILES)``.
"""

from __future__ import annotations

import argparse
import brotli
import hashlib
import json
import random
import re
from pathlib import Path

from .build_frequency import EVALUATION_FILES, load_gold_keys
from .normalize import fold_for_match, normalize

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
OUT = ROOT / "data" / "distill" / "llm-finglish.jsonl.br"
PROVENANCE = ROOT / "data" / "provenance" / "distill.json"

#: Version 2 persona cards, calibrated against the dev set's human typing.
#: Version 1 (careful-aa, casual-a, ou-eh, keyboard) failed that test; see
#: `scripts/fidelity.ts` and data/provenance/distill.json.
PERSONAS = ("everyday", "careful")
_STRIP = re.compile(r"[^\w‌؀-ۿ]|[،؛؟٪-٬۔]")
_PERSIAN_WORD = re.compile(r"^[ء-غف-يپچژکگی‌ٔ]+$")


def words_of(sentence: str) -> list[str] | None:
    """Whitespace words with punctuation stripped; None if any word is not all Persian letters."""
    # Punctuation is a word break, not nothing: `شوهرجان:نایلون` is two words.
    words = [normalize(w) for w in _STRIP.sub(" ", normalize(sentence)).split()]
    words = [w for w in words if w]
    if not words or not all(_PERSIAN_WORD.match(w) for w in words):
        return None
    return words


def sample(source: Path, n: int, seed: int, min_words: int = 4, max_words: int = 18) -> list[dict]:
    import pyarrow.parquet as pq

    excluded = load_gold_keys(*EVALUATION_FILES)
    seen: set[str] = set()
    pool: list[list[str]] = []
    for sentence in pq.read_table(source, columns=["Grapheme"]).column("Grapheme").to_pylist():
        if not sentence or fold_for_match(sentence) in excluded:
            continue
        words = words_of(sentence)
        if words is None or not (min_words <= len(words) <= max_words):
            continue
        key = " ".join(words)
        if key in seen:
            continue
        seen.add(key)
        pool.append(words)
    rng = random.Random(seed)
    chosen = rng.sample(pool, n)
    return [{"id": f"hr-{hashlib.sha256(' '.join(w).encode()).hexdigest()[:10]}", "words": w} for w in chosen]


def write_shards(rows: list[dict], out_dir: Path, shards: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for k in range(shards):
        shard = rows[k::shards]
        path = out_dir / f"shard-{k}.jsonl"
        path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in shard), encoding="utf-8")
        print(f"{path}  {len(shard)} sentences  sha256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]}")


def export_fidelity(out_dir: Path, shards: int) -> None:
    """The dev set's `faithful` Persian, for LLM typists to romanize and be compared with the human."""
    rows = []
    for line in (ROOT / "data" / "dev" / "dev.jsonl").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        words = words_of(row["faithful"])
        if words:
            rows.append({"id": row["id"], "words": words})
    write_shards(rows, out_dir, shards)


def merge(judge_dir: Path, out: Path = OUT, personas: tuple[str, ...] = PERSONAS) -> None:
    """Validate and pack every worker file into the committed artifact (or `out`)."""
    sentences = {}
    for path in sorted(judge_dir.glob("shard-*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            sentences[row["id"]] = row["words"]
    kept, refused = [], 0
    workers: dict[str, int] = {}
    for path in sorted(judge_dir.glob("*-gen-*.jsonl")):
        worker = path.name.split("-gen-")[0]
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            words = sentences.get(row["id"])
            finglish = row.get("finglish")
            if (words is None or row.get("persona") not in personas or not isinstance(finglish, list)
                    or len(finglish) != len(words)
                    or not all(isinstance(f, str) and re.fullmatch(r"[a-z' ]+", f.strip() or "#") for f in finglish)):
                refused += 1
                continue
            kept.append({"id": row["id"], "persona": row["persona"], "worker": worker,
                         "fa": words, "finglish": [f.strip() for f in finglish]})
            workers[worker] = workers.get(worker, 0) + 1
    kept.sort(key=lambda r: (r["id"], r["persona"], r["worker"]))
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept).encode("utf-8")
    out.write_bytes(brotli.compress(payload, quality=11))
    print(json.dumps({"variants": len(kept), "sentences": len({r['id'] for r in kept}),
                      "refused": refused, "byWorker": workers,
                      "sha256": hashlib.sha256(out.read_bytes()).hexdigest()}, indent=2))


def mix(pairs: Path, base: Path, share: float, out_dir: Path, seed: int) -> dict:
    """A training corpus with `share` of its train examples LLM-typed.

    `pairs` is `scripts/align-pairs.ts` output. LLM examples take the synthetic
    corpus's per-word split (`corpus.split_of`), so a Persian word is in the same
    split whichever generator spelled it. `share` 0.5 upsamples LLM examples by
    repetition until they equal the synthetic count; `share` 1.0 drops the
    synthetic train split entirely. The dev and test splits always carry both,
    so every arm selects its checkpoint on the same mixed dev.
    """
    from .corpus import split_of

    rng = random.Random(seed)
    llm: dict[str, list[str]] = {"train": [], "dev": [], "test": []}
    for line in pairs.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        llm[split_of(row["persian"])].append(json.dumps(
            {"latin": row["latin"], "labels": row["labels"], "persian": row["persian"]}, ensure_ascii=False))
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {}
    for split in ("train", "dev", "test"):
        synthetic = (base / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
        if split == "train":
            if share >= 1.0:
                rows = list(llm[split])
            elif share <= 0.0:
                rows = synthetic
            else:
                target = round(len(synthetic) * share / (1 - share))
                repeats = [llm[split][i % len(llm[split])] for i in range(target)]
                rows = synthetic + repeats
        else:
            rows = synthetic + llm[split]
        rng.shuffle(rows)
        (out_dir / f"{split}.jsonl").write_text("\n".join(rows) + "\n", encoding="utf-8")
        counts[split] = {"total": len(rows), "llmDistinct": len(llm[split])}
    manifest = {"base": str(base), "pairs": str(pairs), "share": share, "seed": seed, "examples": counts}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def load() -> list[dict]:
    return [json.loads(line) for line in brotli.decompress(OUT.read_bytes()).decode("utf-8").splitlines()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--export", type=Path)
    parser.add_argument("--export-fidelity", type=Path)
    parser.add_argument("--merge", type=Path)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--personas", default=",".join(PERSONAS))
    parser.add_argument("--mix", type=Path, help="aligned pairs JSONL from scripts/align-pairs.ts")
    parser.add_argument("--base", type=Path, default=Path("corpora/full-v5"))
    parser.add_argument("--share", type=float, default=0.5)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--sentences", type=int, default=3000)
    parser.add_argument("--shards", type=int, default=20)
    parser.add_argument("--seed", type=int, default=20260915)
    args = parser.parse_args()
    if args.export_fidelity:
        export_fidelity(args.export_fidelity, args.shards)
    elif args.export:
        write_shards(sample(args.source, args.sentences, args.seed), args.export, args.shards)
    elif args.mix:
        print(json.dumps(mix(args.mix, args.base, args.share, args.out, args.seed), indent=2))
    elif args.merge:
        merge(args.merge, args.out, tuple(args.personas.split(",")))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

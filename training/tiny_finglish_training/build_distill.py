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
    # a later round: a new seed, sentences already typed dropped, shards continuing the series,
    # and 3,000 of the 10,000 drawn from the clause-final ه subset (see `ends_in_he`)
    python -m tiny_finglish_training.build_distill --export runs/llm/distill --sentences 10000 \
        --targeted 3000 --shards 69 --seed <new> --exclude-typed --shard-start 69
    # a training corpus; --mode decides how --share is reached (see `mix`)
    python -m tiny_finglish_training.build_distill --mix runs/llm/pairs.jsonl --base corpora/full-v5 \
        --share 0.5 --mode upsample --out corpora/mix

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


def sentence_id(words: list[str]) -> str:
    return f"hr-{hashlib.sha256(' '.join(words).encode()).hexdigest()[:10]}"


def typed_ids(artifact: Path = OUT) -> set[str]:
    """Ids already in the committed artifact, so a later round does not re-type them.

    A new seed draws from the same pool, so without this it would re-draw some
    of what is already typed — at 10,049 of a ~250k pool the expected overlap is
    small but not zero, and re-typing is pure waste.
    """
    if not artifact.exists():
        return set()
    return {row["id"] for row in load(artifact)}


def ends_in_he(words: list[str]) -> bool:
    """Sentence's last word is written with a final ه — the clause-final clitic position.

    Measured, because it is why `--targeted` exists: HomoRich is written Persian
    and only 3.4% of the eligible pool ends this way, against 9.7% of the dev
    set's human typing and 18.9% of the gold set's. Written Persian spells the
    copula است; people type it as a ه on the word before. A corpus sampled
    uniformly from HomoRich under-represents that by three to six times, at
    exactly the position `SCORING.finalHe` has to decide.
    """
    return words[-1].endswith("ه")


def sample(source: Path, n: int, seed: int, min_words: int = 4, max_words: int = 18,
           exclude: set[str] | None = None, targeted: int = 0) -> list[dict]:
    """`n` sentences, of which `targeted` are drawn from the `ends_in_he` subset.

    `targeted` 0 is a uniform draw, which is what the first two rounds used.
    """
    import pyarrow.parquet as pq

    excluded = load_gold_keys(*EVALUATION_FILES)
    already = exclude or set()
    seen: set[str] = set()
    pool: list[list[str]] = []
    for sentence in pq.read_table(source, columns=["Grapheme"]).column("Grapheme").to_pylist():
        if not sentence or fold_for_match(sentence) in excluded:
            continue
        words = words_of(sentence)
        if words is None or not (min_words <= len(words) <= max_words):
            continue
        key = " ".join(words)
        if key in seen or sentence_id(words) in already:
            continue
        seen.add(key)
        pool.append(words)
    rng = random.Random(seed)
    print(f"pool {len(pool)} eligible after excluding {len(already)} already typed")
    if targeted:
        rich = [w for w in pool if ends_in_he(w)]
        plain = [w for w in pool if not ends_in_he(w)]
        chosen = rng.sample(rich, targeted) + rng.sample(plain, n - targeted)
        # Shuffled so every shard carries both kinds in proportion.
        rng.shuffle(chosen)
        print(f"sampled {targeted} of {len(rich)} clause-final-ه and {n - targeted} of {len(plain)} "
              f"others at seed {seed}")
    else:
        chosen = rng.sample(pool, n)
        print(f"sampled {n} uniformly at seed {seed}")
    return [{"id": sentence_id(w), "words": w} for w in chosen]


def write_shards(rows: list[dict], out_dir: Path, shards: int, start: int = 0) -> None:
    """`shards` files, numbered from `start` so a later round continues the series."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for k in range(shards):
        shard = rows[k::shards]
        path = out_dir / f"shard-{start + k}.jsonl"
        if path.exists():
            raise SystemExit(f"{path} exists; pass --shard-start past the last round's shards")
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


#: How `mix` reaches the requested LLM share on the train split. See `mix`.
MIX_MODES = ("upsample", "natural", "none")


def train_split(synthetic: list[str], llm: list[str], share: float, mode: str,
                rng: random.Random) -> tuple[list[str], list[str]]:
    """The synthetic and LLM halves of one train split, before shuffling."""
    if mode == "none":
        return synthetic, llm
    if share >= 1.0:
        return [], llm
    if share <= 0.0:
        return synthetic, []
    if mode == "natural":
        keep = round(len(llm) * (1 - share) / share)
        # Below the floor there is nothing left to drop, so the share lands
        # higher than asked; the manifest reports what was actually built.
        return (synthetic if keep >= len(synthetic) else rng.sample(synthetic, keep)), llm
    target = round(len(synthetic) * share / (1 - share))
    return synthetic, [llm[i % len(llm)] for i in range(target)]


def mix(pairs: Path, base: Path, share: float, out_dir: Path, seed: int,
        mode: str = "upsample") -> dict:
    """A training corpus with `share` of its train examples LLM-typed.

    `pairs` is `scripts/align-pairs.ts` output. LLM examples take the synthetic
    corpus's per-word split (`corpus.split_of`), so a Persian word is in the same
    split whichever generator spelled it. `share` 1.0 drops the synthetic train
    split entirely. The dev and test splits always carry both, so every arm
    selects its checkpoint on the same mixed dev.

    `mode` decides how a share between the two ends is reached:

      * `upsample` (default) — repeat LLM examples until they are `share` of the
        train split. What every arm up to v6 was built with, and the default so
        those arms still reproduce. Its cost is that the train size stops
        depending on how much LLM data exists: 3,000 typed sentences and 10,049
        both give 857k train examples, the second repeated 2.6x instead of 8.6x,
        so two thirds of the second corpus buys only less repetition.
      * `natural` — never repeat an LLM example; downsample the synthetic half
        instead. `share` is then bounded below by
        `len(llm) / (len(llm) + len(synthetic))`, and a request under that floor
        keeps every synthetic example and lands above the request.
      * `none` — every synthetic and every LLM example exactly once. `share` is
        ignored. Equivalent to `natural` at any share at or below the floor.
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
        base_rows = (base / f"{split}.jsonl").read_text(encoding="utf-8").splitlines()
        if split == "train":
            synthetic, from_llm = train_split(base_rows, llm[split], share, mode, rng)
        else:
            synthetic, from_llm = base_rows, llm[split]
        rows = synthetic + from_llm
        rng.shuffle(rows)
        (out_dir / f"{split}.jsonl").write_text("\n".join(rows) + "\n", encoding="utf-8")
        counts[split] = {"total": len(rows), "llmRows": len(from_llm),
                         "llmShare": round(len(from_llm) / len(rows), 4) if rows else 0.0,
                         "llmDistinct": len(llm[split])}
    manifest = {"base": str(base), "pairs": str(pairs), "mode": mode, "share": share,
                "seed": seed, "examples": counts}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def load(artifact: Path = OUT) -> list[dict]:
    return [json.loads(line) for line in brotli.decompress(artifact.read_bytes()).decode("utf-8").splitlines()]


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
    parser.add_argument("--mode", choices=MIX_MODES, default="upsample",
                        help="how --share is reached on the train split; see mix()")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--sentences", type=int, default=3000)
    parser.add_argument("--shards", type=int, default=20)
    parser.add_argument("--shard-start", type=int, default=0,
                        help="first shard number, so a later round continues the series")
    parser.add_argument("--exclude-typed", action="store_true",
                        help="--export: drop sentences already in the committed artifact")
    parser.add_argument("--targeted", type=int, default=0,
                        help="--export: how many of --sentences to draw from the clause-final ه subset")
    parser.add_argument("--seed", type=int, default=20260915)
    args = parser.parse_args()
    if args.export_fidelity:
        export_fidelity(args.export_fidelity, args.shards)
    elif args.export:
        exclude = typed_ids() if args.exclude_typed else None
        write_shards(sample(args.source, args.sentences, args.seed, exclude=exclude,
                            targeted=args.targeted),
                     args.export, args.shards, args.shard_start)
    elif args.mix:
        print(json.dumps(mix(args.mix, args.base, args.share, args.out, args.seed, args.mode), indent=2))
    elif args.merge:
        merge(args.merge, args.out, tuple(args.personas.split(",")))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

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
    # 3,000 of the 10,000 drawn from the clause-final ه subset (see `ends_in_he`), and that
    # draw kept in shards 69-89 of its own so it can be typed and measured on its own
    python -m tiny_finglish_training.build_distill --export runs/llm/distill --sentences 10000 \
        --targeted 3000 --targeted-shards 21 --shards 69 --seed <new> \
        --exclude-typed --shard-start 69
    # the chat round: HomoRich sentences with a chat word, 2-12 words, then
    # LLM-written chat lines from a JSONL, each in shards of its own
    python -m tiny_finglish_training.build_distill --export runs/llm/distill --sentences 700 \
        --targeted 700 --targeted-predicate chat-word --min-words 2 --max-words 12 \
        --shards 5 --seed <new> --exclude-typed --shard-start 138
    python -m tiny_finglish_training.build_distill --export runs/llm/distill --sentences 0 \
        --source ../data/chat/chat-lines.jsonl --id-prefix ch- --min-words 1 \
        --shards 6 --shard-start 143
    # a training corpus; --mode decides how --share is reached (see `mix`)
    python -m tiny_finglish_training.build_distill --mix runs/llm/pairs.jsonl --base corpora/full-v5 \
        --share 0.5 --mode upsample --out corpora/mix

Every worker gets whitespace-split Persian words and returns one Finglish
string per word, so word pairs come out aligned without an aligner. A string
may contain a space — `mi konam`, `ketaab haa` — because real typists detach
affixes, and a corpus that never does is not a corpus of real typing.

Source: HomoRich (CC0-1.0), the same file the frequency table is built from,
or any JSONL (`{"text": ...}` rows) or text file of Persian lines, always
through ``load_gold_keys(*EVALUATION_FILES)`` and the chat sets' 4-gram guard.
"""

from __future__ import annotations

import argparse
import brotli
import functools
import hashlib
import json
import random
import re
from pathlib import Path

from .build_frequency import (CHAT_FILES, EVALUATION_FILES, leak_key, load_gold_keys, load_ngrams, ngrams_of,
                              read_sentences)
from .normalize import fold_for_match, normalize

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
OUT = ROOT / "data" / "distill" / "llm-finglish.jsonl.br"
PROVENANCE = ROOT / "data" / "provenance" / "distill.json"
CHAT_WORDS = ROOT / "data" / "chat" / "chat-words.txt"

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


def sentence_id(words: list[str], prefix: str = "hr-") -> str:
    """`prefix` names the source: `hr-` HomoRich, `ch-` the LLM-written chat lines."""
    return f"{prefix}{hashlib.sha256(' '.join(words).encode()).hexdigest()[:10]}"


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


@functools.lru_cache(maxsize=None)
def load_chat_words(path: Path = CHAT_WORDS) -> tuple[frozenset[str], frozenset[str]]:
    """The chat markers and the written-register markers (`!` lines), folded."""
    include: set[str] = set()
    exclude: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        (exclude if line.startswith("!") else include).add(fold_for_match(line.lstrip("!")))
    return frozenset(include), frozenset(exclude)


def has_chat_word(words: list[str]) -> bool:
    """A chat marker from data/chat/chat-words.txt, and no written-register marker.

    Measured, like `ends_in_he`: the frequency table has no کجایی or اوکی, the
    LLM corpus has 6 سلام in 12,971 sentences, and yet HomoRich holds خوبی,
    باشه and آره by the thousand. They sit in short colloquial lines the
    uniform draw's 4-word floor threw away. The `!` half is what keeps "به خوبی
    ... می‌کند" out: without it خوبی draws more written Persian than chat.
    """
    include, exclude = load_chat_words()
    folded = [fold_for_match(w) for w in words]
    return any(w in include for w in folded) and not any(w in exclude for w in folded)


#: What `--targeted` draws from, by name.
PREDICATES = {"ends-in-he": ends_in_he, "chat-word": has_chat_word}


def sample(source: Path, n: int, seed: int, min_words: int = 4, max_words: int = 18,
           exclude: set[str] | None = None, targeted: int = 0,
           shuffle: bool = True, predicate=ends_in_he, id_prefix: str = "hr-") -> list[dict]:
    """`n` sentences, of which `targeted` are drawn from the `predicate` subset.

    `targeted` 0 is a uniform draw, which is what the first two rounds used; `n`
    0 takes the whole eligible pool. `shuffle` False keeps the targeted draw
    first, so a caller can write the two halves into separate shard ranges and
    type one of them on its own.

    The leakage guard is two checks. `leak_key` drops a sentence whose words are
    an evaluation sentence's; the 4-gram check drops one that shares four words
    running with a chat evaluation message, which catches a test message
    embedded in a longer line.
    """
    excluded = load_gold_keys(*EVALUATION_FILES)
    grams = load_ngrams(*CHAT_FILES)
    already = exclude or set()
    seen: set[str] = set()
    pool: list[list[str]] = []
    leaked = 0
    for sentence in read_sentences(source):
        if not sentence:
            continue
        key = leak_key(sentence)
        if key in excluded or ngrams_of(key) & grams:
            leaked += 1
            continue
        words = words_of(sentence)
        if words is None or not (min_words <= len(words) <= max_words):
            continue
        key = " ".join(words)
        if key in seen or sentence_id(words, id_prefix) in already:
            continue
        seen.add(key)
        pool.append(words)
    rng = random.Random(seed)
    print(f"pool {len(pool)} eligible after excluding {len(already)} already typed "
          f"and {leaked} matching an evaluation sentence")
    if n <= 0:
        n = len(pool)
    if targeted:
        rich = [w for w in pool if predicate(w)]
        chosen = rng.sample(rich, targeted)
        # The remainder is drawn uniformly over everything *not already taken*,
        # not over the complement of `rich`. Sampling the complement would make
        # the untargeted half contain no clause-final ه at all, which is a
        # different corpus from the one the round is supposed to blend.
        taken = {" ".join(w) for w in chosen}
        rest = [w for w in pool if " ".join(w) not in taken]
        chosen = chosen + rng.sample(rest, n - targeted)
        if shuffle:
            # Every shard carries both kinds in proportion.
            rng.shuffle(chosen)
        print(f"sampled {targeted} of {len(rich)} matching {predicate.__name__}, then {n - targeted} "
              f"uniformly of the remaining {len(rest)}, at seed {seed}")
    else:
        chosen = rng.sample(pool, n)
        print(f"sampled {n} uniformly at seed {seed}")
    return [{"id": sentence_id(w, id_prefix), "words": w} for w in chosen]


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

#: How `mix` assigns an LLM example to train, dev or test. See `mix`.
LLM_SPLITS = ("word", "sentence")


def llm_split_of(row: dict, by: str) -> str:
    """The split of one aligned LLM pair: by its Persian word, or by its sentence id."""
    from .corpus import split_of

    if by == "sentence":
        if "id" not in row:
            raise SystemExit("--llm-split sentence needs sentence ids: re-run scripts/align-pairs.ts")
        return split_of(row["id"])
    return split_of(row["persian"])


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
        mode: str = "upsample", llm_split: str = "word") -> dict:
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

    `llm_split` decides where an LLM example goes:

      * `word` (default) — the synthetic corpus's per-word split, as above. What
        every model up to v7 was built with. Its blind spot is the chat words:
        `split_of` puts خوبی and چطوره in test, so every typed example of them,
        however many a round types, is held out and never trains.
      * `sentence` — by the hash of the sentence id, so a word trains in the
        sentences that land in train. The model's own dev and test are then no
        longer word-disjoint from train, which only affects checkpoint
        selection; every number this project reports comes from the evaluation
        sets outside the corpus.
    """
    rng = random.Random(seed)
    llm: dict[str, list[str]] = {"train": [], "dev": [], "test": []}
    for line in pairs.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        llm[llm_split_of(row, llm_split)].append(json.dumps(
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
    manifest = {"base": str(base), "pairs": str(pairs), "mode": mode, "llmSplit": llm_split,
                "share": share, "seed": seed, "examples": counts}
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
    parser.add_argument("--llm-split", choices=LLM_SPLITS, default="word",
                        help="--mix: place LLM examples by Persian word or by sentence; see mix()")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE,
                        help="HomoRich parquet, a JSONL of {\"text\": ...} rows, or a text file of lines")
    parser.add_argument("--min-words", type=int, default=4)
    parser.add_argument("--max-words", type=int, default=18)
    parser.add_argument("--id-prefix", default="hr-",
                        help="--export: sentence-id prefix naming the source (hr- HomoRich, ch- chat lines)")
    parser.add_argument("--sentences", type=int, default=3000)
    parser.add_argument("--shards", type=int, default=20)
    parser.add_argument("--shard-start", type=int, default=0,
                        help="first shard number, so a later round continues the series")
    parser.add_argument("--exclude-typed", action="store_true",
                        help="--export: drop sentences already in the committed artifact")
    parser.add_argument("--targeted", type=int, default=0,
                        help="--export: how many of --sentences to draw from the --targeted-predicate subset")
    parser.add_argument("--targeted-predicate", choices=sorted(PREDICATES), default="ends-in-he",
                        help="--export: which subset --targeted draws from")
    parser.add_argument("--targeted-shards", type=int, default=0,
                        help="--export: put the targeted draw in this many shards of its own, first, "
                             "so it can be typed and measured before the rest")
    parser.add_argument("--seed", type=int, default=20260915)
    args = parser.parse_args()
    if args.export_fidelity:
        export_fidelity(args.export_fidelity, args.shards)
    elif args.export:
        exclude = typed_ids() if args.exclude_typed else None
        draw = dict(min_words=args.min_words, max_words=args.max_words, exclude=exclude,
                    targeted=args.targeted, predicate=PREDICATES[args.targeted_predicate],
                    id_prefix=args.id_prefix)
        if args.targeted_shards:
            rows = sample(args.source, args.sentences, args.seed, shuffle=False, **draw)
            write_shards(rows[:args.targeted], args.export, args.targeted_shards, args.shard_start)
            write_shards(rows[args.targeted:], args.export, args.shards - args.targeted_shards,
                         args.shard_start + args.targeted_shards)
        else:
            write_shards(sample(args.source, args.sentences, args.seed, **draw),
                         args.export, args.shards, args.shard_start)
    elif args.mix:
        print(json.dumps(mix(args.mix, args.base, args.share, args.out, args.seed, args.mode,
                             args.llm_split), indent=2))
    elif args.merge:
        merge(args.merge, args.out, tuple(args.personas.split(",")))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

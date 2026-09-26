"""Build the Persian word-frequency artifact.

This closes the gap that lexicon membership alone cannot: both سلام and سلم are
real Persian words, so knowing they exist says nothing about which one a user
meant. Frequency does.

Source: the Persian side of HomoRich (CC0-1.0), 511,660 sentences after the
gold exclusion, 4.39M word tokens. Chosen over a larger web corpus for two
reasons — it is already CC0 with a verified provenance chain, and its register
(Common Voice, ManaTTS, colloquial) is far closer to what Finglish users write
than encyclopedic or news text. Domain match is worth several points on this
family of task; raw size is worth less.

The same gold-sentence exclusion as `build_pronunciation.py` applies, for the
same reason: HomoRich shares 97.3% of its sentences with the gold set, and a
frequency table built from the evaluation data is a subtler kind of leak than a
memorized sentence but a leak all the same.

Format — two files' worth of information in one blob:
    u32                    word count N
    front-coded word list  N words, sorted (see src/frontcode.ts)
    N bytes                log-quantized frequency rank, same order

Storing the words sorted rather than frequency-ordered costs nothing: the rank
byte carries the frequency, and sorted order is what makes front-coding work.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import re
import struct
from pathlib import Path

import brotli

from .normalize import fold_for_match, normalize

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
DEFAULT_OUT = ROOT / "data" / "lexicon" / "fa-frequency.bin"

TERMINATOR = 0xFF
ZWNJ_CHAR = "\u200c"
_PUNCT = re.compile(r"[^\w‌؀-ۿ]")
#: A word break for the leakage key: anything that is not a letter, plus the
#: Persian marks that sit inside the Arabic block.
_WORD_BREAK = re.compile(r"[^\w‌؀-ۿ]|[،؛؟٪-٬۔]")


def encode_front_coded(words: list[str]) -> tuple[bytes, list[str]]:
    """Mirror of `encodeFrontCoded` in src/frontcode.ts, minus the header."""
    alphabet = sorted({c for w in words for c in w})
    if len(alphabet) > 255:
        raise ValueError(f"alphabet of {len(alphabet)} exceeds 255")
    code = {c: i for i, c in enumerate(alphabet)}
    out = bytearray([len(alphabet)])
    for c in alphabet:
        out += struct.pack("<H", ord(c))
    out += struct.pack("<I", len(words))
    previous = ""
    for word in words:
        shared = 0
        limit = min(len(word), len(previous), 255)
        while shared < limit and word[shared] == previous[shared]:
            shared += 1
        out.append(shared)
        out += bytes(code[c] for c in word[shared:])
        out.append(TERMINATOR)
        previous = word
    return bytes(out), alphabet


def leak_key(text: str) -> str:
    """The leakage guard's key for one sentence: its folded words, one space apart.

    Words and not the raw string. Keyed on the string, "سلام، خوبی؟" slips past
    an evaluation row "سلام خوبی" — harmless when every evaluation sentence was
    a long read-aloud one, not once the chat sets hold two-word messages that a
    corpus writes with a comma. `fold_for_match` per word also makes می‌خوام and
    میخوام one key.
    """
    return " ".join(fold_for_match(w) for w in _WORD_BREAK.sub(" ", normalize(text)).split())


def read_sentences(source: Path) -> list[str]:
    """Persian sentences from a HomoRich parquet, a JSONL, or a text file of lines.

    A JSONL row gives its sentence as `text`, or as `words` (a shard file from
    `build_distill.py --export`).
    """
    if source.suffix == ".parquet":
        import pyarrow.parquet as pq

        return pq.read_table(source, columns=["Grapheme"]).column("Grapheme").to_pylist()
    lines = [line for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
    if source.suffix == ".jsonl":
        rows = [json.loads(line) for line in lines]
        return [row["text"] if "text" in row else " ".join(row["words"]) for row in rows]
    return [line for line in lines if not line.startswith("#")]


def load_gold_keys(*golds: Path) -> set[str]:
    """Match keys (`leak_key`) for every evaluation sentence, for the leakage guard.

    Factored out because `build_bigram.py` must use exactly this guard and not
    a second implementation of it. A bigram model memorizes sentence-local
    structure far more readily than a unigram count does, so a divergence here
    would be a leak that shows up as a good score.

    Missing files are skipped: a checkout without the quarantine file should
    still build, and excluding fewer sentences can only make the guard
    stricter-looking than it is, never the reverse — which is why the manifest
    records which files were actually read.
    """
    keys: set[str] = set()
    for gold in golds:
        if not gold.exists():
            continue
        for line in gold.read_text(encoding="utf-8").splitlines():
            if line:
                row = json.loads(line)
                # Dev rows may be trimmed to an aligned span; `source` is the
                # whole sentence, which is what HomoRich holds. Fixture rows
                # that assert a copy have no Persian reference at all.
                text = row.get("source") or row.get("expected")
                if text:
                    keys.add(leak_key(text))
    return keys


def load_ngrams(*files: Path, n: int = 4) -> set[tuple[str, ...]]:
    """Every word `n`-gram of the evaluation sentences in `files`, folded as `leak_key` is.

    The chat sets need this on top of the sentence key. A training sentence
    that *contains* a four-word test message, or shares four words running
    with it, teaches the model that message word for word; an exact-match key
    never sees it.
    """
    grams: set[tuple[str, ...]] = set()
    for path in files:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line:
                row = json.loads(line)
                grams |= ngrams_of(leak_key(row.get("source") or row.get("expected") or ""), n)
    return grams


def ngrams_of(key: str, n: int = 4) -> set[tuple[str, ...]]:
    words = key.split()
    return {tuple(words[i:i + n]) for i in range(len(words) - n + 1)}


#: Every file whose sentences are excluded from corpus counts: both gold files,
#: including the quarantined rows (still gold-derived text), the dev set, so a
#: table tuned against dev was never counted over it, the fixtures, and both chat
#: sets.
#: The chat evaluation sets. Short messages, so they also get the 4-gram guard
#: (`load_ngrams`) wherever a chat corpus is drawn.
CHAT_FILES = [
    ROOT / "data" / "chat" / "chat-dev.jsonl",
    ROOT / "data" / "chat" / "chat-test.jsonl",
]

EVALUATION_FILES = [
    ROOT / "data" / "gold" / "gold.jsonl",
    ROOT / "data" / "gold" / "gold-misaligned.jsonl",
    ROOT / "data" / "dev" / "dev.jsonl",
    ROOT / "data" / "fixtures" / "fixtures.jsonl",
    *CHAT_FILES,
]


def supplement_words(files: list[Path], table: set[str], golds: list[Path], min_count: int) -> dict[str, int]:
    """Words of `files` absent from `table` and seen at least `min_count` times there.

    The chat round's reason for this: HomoRich's top 25,000 has no کجایی,
    اوکی or فدات, and there is no other way into the table. `files` is the
    Persian side of the chat training pool, never an evaluation set — and to
    make that a check rather than a promise, a line whose words are an
    evaluation sentence is skipped here too.

    A word counts as present when its solid form is, since the engine indexes
    the table solid (`SkeletonIndex`): میخوام is not added over a table
    می‌خوام.
    """
    gold_keys = load_gold_keys(*golds)
    solid = {w.replace(ZWNJ_CHAR, "") for w in table}
    counts: collections.Counter[str] = collections.Counter()
    for path in files:
        for sentence in read_sentences(path):
            if not sentence or leak_key(sentence) in gold_keys:
                continue
            # `_WORD_BREAK`, not the table's `_PUNCT`: chat lines carry ؟ and ،,
            # which sit inside the Arabic block `_PUNCT` keeps.
            for word in _WORD_BREAK.sub(" ", normalize(sentence)).split():
                if word.replace(ZWNJ_CHAR, "") not in solid:
                    counts[word] += 1
    # One spelling per solid form, the commoner, counted over both: میخوام and
    # می‌خوام are one word and take one slot.
    spellings: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for word, count in counts.items():
        spellings[word.replace(ZWNJ_CHAR, "")][word] += count
    return {forms.most_common(1)[0][0]: total for forms in spellings.values()
            if (total := sum(forms.values())) >= min_count}


def build(source: Path, out: Path, golds: list[Path], top: int,
          supplement: list[Path] | None = None, supplement_score: float = 0.3,
          supplement_min: int = 2) -> dict:
    import pyarrow.parquet as pq

    gold_keys = load_gold_keys(*golds)

    table = pq.read_table(source, columns=["Grapheme"])
    counts: collections.Counter[str] = collections.Counter()
    used = excluded = 0
    for sentence in table.column("Grapheme").to_pylist():
        if not sentence:
            continue
        if leak_key(sentence) in gold_keys:
            excluded += 1
            continue
        used += 1
        for word in sentence.split():
            word = normalize(_PUNCT.sub("", word))
            if word:
                counts[word] += 1

    tokens = sum(counts.values())
    kept = counts.most_common(top)
    coverage = sum(c for _, c in kept) / tokens

    # Log-quantize to one byte. Frequency spans ~6 orders of magnitude and only
    # its logarithm is ever used (as a ranking score), so a byte is ample and a
    # float array would be 4x the size for no gain.
    peak = kept[0][1]
    ranked = {w: max(1, min(255, round(255 * math.log1p(c) / math.log1p(peak)))) for w, c in kept}
    # Supplement words have no HomoRich count worth the name, so they all enter
    # at one score, swept in the chat round rather than derived.
    added = supplement_words(supplement, set(ranked), golds, supplement_min) if supplement else {}
    for word in added:
        ranked[word] = max(1, min(255, round(255 * supplement_score)))

    words = sorted(ranked)
    blob, alphabet = encode_front_coded(words)
    blob += bytes(ranked[w] for w in words)
    compressed = brotli.compress(blob, quality=11)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(compressed)

    return {
        "source": "MahtaFetrat/HomoRich-G2P-Persian (Persian side)",
        "sourceLicense": "CC0-1.0",
        "sentencesUsed": used,
        "sentencesExcludedAsGold": excluded,
        "evaluationFilesExcluded": [str(p.relative_to(ROOT)) for p in golds if p.exists()],
        "wordTokens": tokens,
        "wordTypes": len(counts),
        "kept": len(words),
        **({"supplement": {
            "files": [str(p.relative_to(ROOT)) if p.is_absolute() and p.is_relative_to(ROOT) else str(p)
                      for p in supplement],
            "score": supplement_score,
            "minCount": supplement_min,
            "words": len(added),
            "counts": dict(sorted(added.items(), key=lambda kv: (-kv[1], kv[0]))),
        }} if supplement else {}),
        "tokenCoverage": round(coverage, 4),
        "alphabet": len(alphabet),
        "rawBytes": len(blob),
        "brotliBytes": len(compressed),
        "sha256": hashlib.sha256(compressed).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--gold", type=Path, nargs="+", default=EVALUATION_FILES)
    parser.add_argument("--top", type=int, default=25000)
    parser.add_argument("--supplement", type=Path, nargs="+",
                        help="Persian lines (JSONL/text) whose out-of-table words are added; see supplement_words")
    parser.add_argument("--supplement-score", type=float, default=0.3,
                        help="the one score, in [0,1], every supplement word enters at")
    parser.add_argument("--supplement-min", type=int, default=2,
                        help="how many times a word must occur in --supplement to be added")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"{args.source} not found; see build_pronunciation.py for the download line.")

    manifest = build(args.source, args.out, list(args.gold), args.top,
                     args.supplement, args.supplement_score, args.supplement_min)
    (ROOT / "data" / "provenance" / "frequency.json").write_text(
        json.dumps({"$comment": "GENERATED by training/tiny_finglish_training/build_frequency.py.", **manifest},
                   indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

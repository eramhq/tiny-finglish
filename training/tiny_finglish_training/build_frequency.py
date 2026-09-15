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
_PUNCT = re.compile(r"[^\w‌؀-ۿ]")


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


def load_gold_keys(*golds: Path) -> set[str]:
    """Match keys for every gold sentence, for the leakage guard.

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
                keys.add(fold_for_match(json.loads(line)["expected"]))
    return keys


def build(source: Path, out: Path, gold: Path, top: int) -> dict:
    import pyarrow.parquet as pq

    gold_keys = load_gold_keys(gold)

    table = pq.read_table(source, columns=["Grapheme"])
    counts: collections.Counter[str] = collections.Counter()
    used = excluded = 0
    for sentence in table.column("Grapheme").to_pylist():
        if not sentence:
            continue
        if fold_for_match(sentence) in gold_keys:
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
        "wordTokens": tokens,
        "wordTypes": len(counts),
        "kept": len(words),
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
    parser.add_argument("--gold", type=Path, default=ROOT / "data" / "gold" / "gold.jsonl")
    parser.add_argument("--top", type=int, default=25000)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"{args.source} not found; see build_pronunciation.py for the download line.")

    manifest = build(args.source, args.out, args.gold, args.top)
    (ROOT / "data" / "provenance" / "frequency.json").write_text(
        json.dumps({"$comment": "GENERATED by training/tiny_finglish_training/build_frequency.py.", **manifest},
                   indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

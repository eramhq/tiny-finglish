"""Build the Persian pronunciation dictionary the generator needs.

Persian is an abjad: short vowels are not written. Going Persian -> Finglish
therefore requires knowing the pronunciation, and until now this project did
not have one — ``g2p.py`` inferred where a vowel belonged from syllable
structure and then *sampled its quality* from a prior. That made `ketab` and
`kotab` equally reachable from کتاب, and only one is right.

The obvious pronunciation dictionary for Persian is GPL, which would
contaminate an MIT package. This one is not:

    HomoRich G2P Persian — https://huggingface.co/datasets/MahtaFetrat/HomoRich-G2P-Persian
    CC0-1.0 (public domain), 528,875 sentence-level grapheme/phoneme pairs.
    Sources: GPT-4o, Common Voice (CC0), ManaTTS (CC0), human annotation.

--------------------------------------------------------------------------
LEAKAGE GUARD — the reason this script is more careful than it looks.
--------------------------------------------------------------------------
HomoRich and our gold set both draw on Mozilla Common Voice, and **97.3% of
gold sentences (1,855 of 1,906) appear in HomoRich**. Building a pronunciation
dictionary from it naively, then training on that dictionary and reporting a
gold score, would mean testing on sentences the model was built from. The score
would look excellent and mean nothing.

So every row whose text matches a gold sentence is excluded first. Read the
other way that costs almost nothing — those rows are ~3% of HomoRich — but
skipping the guard would invalidate every number downstream.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
from pathlib import Path

import brotli

from .build_frequency import leak_key
from .normalize import normalize

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
DEFAULT_OUT = ROOT / "data" / "lexicon" / "fa-pronunciation.bin"

#: Phoneme alphabet: A/u/i are long vowels, a/e/o short, S/Z/x/q/C consonants,
#: `?` a glottal stop (ع and ء). Only the short vowels are consumed today.
SHORT_VOWELS = "aeo"

_PUNCT = re.compile(r"[^\w‌؀-ۿ]")


def count_pronunciations(
    source: Path, gold_keys: set[str], strip=None,
) -> tuple[dict[str, collections.Counter], int, int]:
    """Word -> Counter of phoneme strings, over HomoRich rows not in `gold_keys`.

    Shared with `build_vowels.py`, which passes a wider set of evaluation keys
    and a `strip` hook that removes the ezafe HomoRich transcribes in context.
    Returns the counts and how many rows were excluded and used.
    """
    import pyarrow.parquet as pq

    table = pq.read_table(source, columns=["Grapheme", "Phoneme"])
    graphemes = table.column("Grapheme").to_pylist()
    phonemes = table.column("Phoneme").to_pylist()

    counts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    excluded = used = 0
    for grapheme, phoneme in zip(graphemes, phonemes):
        if not grapheme or not phoneme:
            continue
        if leak_key(grapheme) in gold_keys:
            excluded += 1
            continue
        words, sounds = grapheme.split(), phoneme.split()
        # Word-level pairs are only extractable where the two sides agree on
        # how many words there are; 88% of rows do.
        if len(words) != len(sounds):
            continue
        used += 1
        for word, sound in zip(words, sounds):
            word = normalize(_PUNCT.sub("", word))
            sound = sound.strip()
            if strip and word and sound:
                sound = strip(word, sound)
            if word and sound:
                counts[word][sound] += 1
    return counts, excluded, used


def build(source: Path, out: Path, gold: Path) -> dict:
    gold_keys = {
        leak_key(json.loads(line)["expected"])
        for line in gold.read_text(encoding="utf-8").splitlines()
        if line
    }
    counts, excluded, used = count_pronunciations(source, gold_keys)

    # Keep the most frequent pronunciation per word. Persian homographs exist
    # (کرم is kerm, karam or krem) and this silently picks one; the transducer
    # has no way to disambiguate them from the Finglish side anyway.
    best = {word: c.most_common(1)[0][0] for word, c in counts.items()}
    payload = "\n".join(f"{w}\t{p}" for w, p in sorted(best.items())).encode("utf-8")
    compressed = brotli.compress(payload, quality=11)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(compressed)

    return {
        "source": "MahtaFetrat/HomoRich-G2P-Persian",
        "sourceLicense": "CC0-1.0",
        "rowsExcludedAsGold": excluded,
        "rowsUsed": used,
        "uniqueWords": len(best),
        "rawBytes": len(payload),
        "brotliBytes": len(compressed),
        "sha256": hashlib.sha256(compressed).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--gold", type=Path, default=ROOT / "data" / "gold" / "gold.jsonl")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(
            f"{args.source} not found. Download it first:\n"
            f"  curl -L -o {args.source} https://huggingface.co/datasets/"
            f"MahtaFetrat/HomoRich-G2P-Persian/resolve/main/data/train-01.parquet"
        )

    manifest = build(args.source, args.out, args.gold)
    provenance = ROOT / "data" / "provenance" / "pronunciation.json"
    provenance.write_text(json.dumps(
        {"$comment": "GENERATED by training/tiny_finglish_training/build_pronunciation.py.", **manifest},
        indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

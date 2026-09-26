"""Build the vowel-agreement artifact: which vowels each confusable word has.

Persian does not write short vowels, and a typed `a` can be ا or nothing. So
`salam` reaches both سلام ("hello") and سالم ("healthy"), each with one ا and
one unwritten vowel, and the channel in `src/dictionary.ts` scores them
identically. Frequency then decides, and the table is counted over written
Persian, where سالم is the more common word. In typed chat it is the other way
round.

What separates them is the vowel the script does not write. سالم is *sālem*:
a typed `salam` has an `a` where the word has an `e`, which is evidence against
it, and سلام is *salām*, which agrees with both. This artifact carries exactly
that evidence and nothing else — `src/vowels.ts` turns it into a score term.

**Only confusable words are stored.** A word needs its vowels only when
another table word differs from it by nothing but ا/آ: that is the one choice
a typed `a` leaves open and the frequency table cannot settle on its own. Of
the 25,000 frequency-table words, the groups that survive — two or more
members, with vowel sequences that actually differ — are a small fraction, and
that is what keeps this inside the size budget; the whole dictionary is 371 KiB.

The pronunciation dictionary was tried once before, **as training data**, and
turned off (`ac93c47`): fixed vowels cut the spelling diversity the model
learns from. This uses it as a *scoring feature*, which touches no training
data at all.

Source and leakage: HomoRich (CC0-1.0), the same rows `build_pronunciation.py`
reads, recounted here through `load_gold_keys(*EVALUATION_FILES)` — the
frequency table's guard, which also excludes the quarantined gold rows and the
dev set. The committed pronunciation dictionary excludes only `gold.jsonl`, so
it is not reused directly.

HomoRich transcribes words in context, so a consonant-final word often carries
its ezafe (`عاشق ?ASeqe`, `سهم sahme`). That `e` is not part of the word and is
stripped before counting — as is the `ye` of an ezafe after ا, و or ی.

Format — after Brotli:
    front-coded word list   N words, sorted (see src/frontcode.ts)
    N vowel strings         same order, ASCII over `aeoAiu`, each ended by 0x0A

    python -m tiny_finglish_training.build_vowels
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
from pathlib import Path

import brotli

from .build_frequency import EVALUATION_FILES, encode_front_coded, load_gold_keys
from .build_pronunciation import count_pronunciations
from .lexicon import decode_front_coded

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
DEFAULT_FREQUENCY = ROOT / "data" / "lexicon" / "fa-frequency.bin"
DEFAULT_OUT = ROOT / "data" / "lexicon" / "fa-vowels.bin"

#: HomoRich's vowels: a/e/o short (unwritten), A/i/u long.
VOWELS = "aeoAiu"
#: Letters that end a Persian word in a vowel. Any other final letter is a
#: consonant, and a trailing `e` after it can only be an ezafe.
VOWEL_LETTERS = "اآویه"
#: Removed to find a word's confusable group: the letters a typed `a` may or
#: may not stand for.
ALEF = str.maketrans("", "", "اآ")


def strip_ezafe(word: str, phoneme: str) -> str:
    """Drop an ezafe HomoRich transcribed onto `word` in context."""
    if word[-1] not in VOWEL_LETTERS:
        if len(phoneme) > 1 and phoneme.endswith("e") and phoneme[-2] not in VOWELS:
            return phoneme[:-1]
    elif word[-1] in "اوی" and len(phoneme) > 2 and phoneme.endswith("ye") and phoneme[-3] in VOWELS:
        return phoneme[:-2]
    return phoneme


def vowels(phoneme: str) -> str:
    return "".join(c for c in phoneme if c in VOWELS)


def frequency_words(path: Path) -> list[str]:
    return decode_front_coded(brotli.decompress(path.read_bytes()))


def build(source: Path, frequency: Path, out: Path, golds: list[Path]) -> dict:
    words = frequency_words(frequency)
    gold_keys = load_gold_keys(*golds)
    counts, excluded, used = count_pronunciations(source, gold_keys, strip=strip_ezafe)

    groups: dict[str, list[str]] = collections.defaultdict(list)
    for word in words:
        groups[word.translate(ALEF)].append(word)

    kept: dict[str, str] = {}
    confusable = 0
    for members in groups.values():
        if len(members) < 2:
            continue
        confusable += len(members)
        known = {w: vowels(counts[w].most_common(1)[0][0]) for w in members if counts.get(w)}
        # A group whose members all have the same vowels carries no evidence
        # this term could use, so it costs bytes for nothing.
        if len(known) >= 2 and len(set(known.values())) >= 2:
            kept.update(known)

    ordered = sorted(kept)
    blob, alphabet = encode_front_coded(ordered)
    blob += b"".join(kept[w].encode("ascii") + b"\n" for w in ordered)
    compressed = brotli.compress(blob, quality=11)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(compressed)

    return {
        "source": "MahtaFetrat/HomoRich-G2P-Persian",
        "sourceLicense": "CC0-1.0",
        "rowsExcludedAsGold": excluded,
        "rowsUsed": used,
        "evaluationFilesExcluded": [str(p.relative_to(ROOT)) for p in golds if p.exists()],
        "frequencyWords": len(words),
        "confusableWords": confusable,
        "kept": len(ordered),
        "alphabet": len(alphabet),
        "rawBytes": len(blob),
        "brotliBytes": len(compressed),
        "sha256": hashlib.sha256(compressed).hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--frequency", type=Path, default=DEFAULT_FREQUENCY)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--gold", type=Path, nargs="+", default=EVALUATION_FILES)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"{args.source} not found; see build_pronunciation.py for the download line.")

    manifest = build(args.source, args.frequency, args.out, list(args.gold))
    (ROOT / "data" / "provenance" / "vowels.json").write_text(
        json.dumps({"$comment": "GENERATED by training/tiny_finglish_training/build_vowels.py.", **manifest},
                   indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

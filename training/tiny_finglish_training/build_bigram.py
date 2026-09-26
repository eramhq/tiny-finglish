"""Build the Persian word-bigram artifact — sentence context, in 73.6 KiB.

**This artifact is not shipped by default**, and the reason is arithmetic
rather than doubt about the method: 73.6 KiB for +0.9 points of gold word
accuracy on the rule baseline is 82 KiB per point, against 8.9 for
`fa-frequency.bin`. It is the worst accuracy-per-byte artifact in the
repository, so it is built, committed, tested and documented, and left opt-in
behind `--bigram`. `bigramGain` in `data/results/comparison.json` publishes what
it buys for every configuration — including +2.6 points for rules *without* the
frequency table, which is the tier where it is worth most.

The frequency table says which Persian word is likely; it cannot say which one
is likely *here*. `قلب` and `قالب` and `غالب` are all real and all reachable
from `ghaleb`, and only the neighbours decide. This is the artifact that lets
`sentencePass()` in `src/index.ts` make that call.

**What it can and cannot buy, measured before it was built.** A bigram model is
a reranker: it reorders candidates the decoder already produced and can never
introduce one it did not. `scripts/oracle.ts` puts that ceiling at +9.6 points
on the gold set with a *perfect* reranker, against +28.8 that the roadmap had
assumed from prior art. That prior art sat on top of a pair 6-gram FST, whose
candidate recall is far higher than this beam's; its 21-point figure describes a
ranking-limited system and this one is recall-limited. Budget accordingly.

**Scores are pointwise mutual information, not conditional probability.** Two
reasons, and the second is the load-bearing one:

  * PMI is comparable across heads, so a rare first word does not drag every
    continuation down relative to a common one.
  * It makes "pair not in the table" mean *zero*, which is the correct
    back-off. Storing log P(w2|w1) would make an unseen pair score 0 and every
    seen pair score negative, so pruning a pair would *promote* it. The same
    argument `src/frequency.ts` makes for unknown words, one order up.

Negative PMI is clipped away: the table only ever says "these two words go
together", never "these two do not". Keeping the negative tail would double the
entries for evidence that is mostly sampling noise at these counts.

Source and leakage: HomoRich (CC0-1.0), the Persian side, exactly as
`build_frequency.py` uses it, and through the same gold-sentence exclusion —
`load_gold_keys` is imported from that module rather than reimplemented. 97.3%
of gold sentences appear in HomoRich, because both draw on Common Voice, so
this guard is not optional. Both gold files are excluded, including the
quarantined rows: they are still gold-derived text.

Format — after Brotli:
    front-coded word list   V words, sorted (see src/frontcode.ts)
    u32                     total pair count P
    per head, in sorted order:
        varint              k, the number of continuations
        k x varint          tail word ids, sorted and delta-coded
    P bytes                 PMI, quantized to 0-255

Delta-coded ids inside a head are small and repetitive, which is what makes the
varint stream compress; the scores are near-maximum-entropy and cost about
their own byte. Grouping all the scores after all the ids keeps those two very
different distributions out of each other's way.

    python -m tiny_finglish_training.build_bigram
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

from .build_frequency import EVALUATION_FILES, encode_front_coded, leak_key, load_gold_keys
from .normalize import normalize

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = Path("corpora/homorich.parquet")
DEFAULT_OUT = ROOT / "data" / "lexicon" / "fa-bigram.bin"

_PUNCT = re.compile(r"[^\w‌؀-ۿ]")

#: PMI above this is clipped. Six nats is a 400x lift over independence; pairs
#: beyond it are collocations whose exact strength does not change a ranking.
MAX_PMI = 6.0


def varint(value: int) -> bytes:
    """Unsigned LEB128. Mirrored by `readVarint` in src/bigram.ts."""
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def build(source: Path, out: Path, golds: list[Path], vocab_size: int, min_count: int,
          max_pairs: int, rank: str = "count") -> dict:
    import pyarrow.parquet as pq

    gold_keys = load_gold_keys(*golds)

    table = pq.read_table(source, columns=["Grapheme"])
    unigrams: collections.Counter[str] = collections.Counter()
    sentences: list[list[str]] = []
    used = excluded = 0

    for sentence in table.column("Grapheme").to_pylist():
        if not sentence:
            continue
        if leak_key(sentence) in gold_keys:
            excluded += 1
            continue
        used += 1
        words = [normalize(_PUNCT.sub("", w)) for w in sentence.split()]
        words = [w for w in words if w]
        if len(words) < 2:
            continue
        sentences.append(words)
        unigrams.update(words)

    tokens = sum(unigrams.values())
    # The bigram vocabulary is its own list rather than a reference into
    # fa-frequency.bin: the two artifacts are loaded independently, and a
    # shared id space would make either one unreadable without the other.
    vocab = {w for w, _ in unigrams.most_common(vocab_size)}

    pairs: collections.Counter[tuple[str, str]] = collections.Counter()
    pair_tokens = 0
    for words in sentences:
        for a, b in zip(words, words[1:]):
            pair_tokens += 1
            if a in vocab and b in vocab:
                pairs[(a, b)] += 1

    # Pointwise mutual information, clipped at zero. Scored only for pairs seen
    # often enough that the estimate means something: at count 1 the PMI of any
    # two rare words is enormous and entirely an artifact of the sample size.
    scored: list[tuple[str, str, float]] = []
    for (a, b), count in pairs.items():
        if count < min_count:
            continue
        pmi = math.log((count / pair_tokens) / ((unigrams[a] / tokens) * (unigrams[b] / tokens)))
        if pmi > 0:
            # Rank by evidence, not by lift alone: a pair seen 4,000 times at
            # PMI 2 settles more rankings than one seen 5 times at PMI 9.
            scored.append((a, b, min(pmi, MAX_PMI)))

    # Prune by raw count, not by lift. A reranker is only worth anything on the
    # pairs it actually sees: ranking by count x PMI keeps the sharpest
    # collocations and reaches 24.0% of the gold set's adjacent reference pairs,
    # where ranking by count alone reaches 27.2% at a smaller byte budget --
    # concentrating on frequent words shrinks the word list as well as raising
    # coverage. The *score* stays PMI either way; what changes is which pairs
    # earn a slot.
    #
    # 30,000 is the knee on `data/fixtures/`: 15k and 20k score 74.9% against
    # 75.3% at 30k, and 45k adds 37 KiB for nothing. Chosen there, then
    # reported on gold, never the other way round.
    scored.sort(key=lambda row: -(pairs[(row[0], row[1])] if rank == "count" else
                                  pairs[(row[0], row[1])] * row[2]))
    kept = scored[:max_pairs]

    # Only words that actually appear in a kept pair need to be in the word
    # list. Dropping the rest is free and typically removes a third of it.
    live = sorted({a for a, _, _ in kept} | {b for _, b, _ in kept})
    index = {w: i for i, w in enumerate(live)}

    by_head: dict[int, list[tuple[int, float]]] = collections.defaultdict(list)
    for a, b, pmi in kept:
        by_head[index[a]].append((index[b], pmi))

    blob, alphabet = encode_front_coded(live)
    blob += struct.pack("<I", len(kept))

    ids = bytearray()
    scores = bytearray()
    for head in range(len(live)):
        tails = sorted(by_head.get(head, []))
        ids += varint(len(tails))
        previous = 0
        for tail, pmi in tails:
            ids += varint(tail - previous)
            previous = tail
            scores.append(max(1, min(255, round(255 * pmi / MAX_PMI))))
    blob += bytes(ids) + bytes(scores)

    compressed = brotli.compress(blob, quality=11)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(compressed)

    covered = sum(pairs[(a, b)] for a, b, _ in kept)
    return {
        "source": "MahtaFetrat/HomoRich-G2P-Persian (Persian side)",
        "sourceLicense": "CC0-1.0",
        "sentencesUsed": used,
        "sentencesExcludedAsGold": excluded,
        "goldFilesExcluded": [str(p.relative_to(ROOT)) for p in golds],
        "wordTokens": tokens,
        "bigramTokens": pair_tokens,
        "vocabConsidered": vocab_size,
        "distinctPairs": len(pairs),
        "pairsAboveMinCount": len(scored),
        "kept": len(kept),
        "words": len(live),
        "pairTokenCoverage": round(covered / pair_tokens, 4),
        "minCount": min_count,
        "prunedBy": rank,
        "maxPmi": MAX_PMI,
        "score": "pointwise mutual information, clipped to [0, maxPmi], quantized to one byte",
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
    parser.add_argument("--vocab", type=int, default=25000)
    parser.add_argument("--min-count", type=int, default=3)
    parser.add_argument("--max-pairs", type=int, default=30000)
    parser.add_argument("--rank", choices=["count", "lift"], default="count")
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"{args.source} not found; see build_pronunciation.py for the download line.")

    manifest = build(args.source, args.out, list(args.gold), args.vocab, args.min_count,
                     args.max_pairs, args.rank)
    (ROOT / "data" / "provenance" / "bigram.json").write_text(
        json.dumps({"$comment": "GENERATED by training/tiny_finglish_training/build_bigram.py.", **manifest},
                   indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

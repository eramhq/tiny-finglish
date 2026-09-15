"""Label set construction — turning aligned chunks into per-character targets.

The transducer is a *tagger*: one label per input character. Transliteration is
monotonic (no reordering between Finglish and Persian), so a per-position
classifier is smaller and markedly easier to train than a decoder, while beam
search over its per-position distributions still yields alternatives and
confidence.

Unequal lengths — `emrooz` is 6 characters, امروز is 5 — are handled by two
devices that are standard in monotonic transduction:

  * the **empty label**, emitted when a Latin character contributes nothing
    (the second `o` of `oo`);
  * **multi-character labels**, emitted when one Latin character stands for
    several Persian ones (the `a` of `khahar` carries وا, because the و of
    خواهر is silent).

Because ``g2p.py`` produces the alignment, no separate aligner is needed.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .g2p import Chunk

#: Latin input alphabet. Deliberately small and closed: anything outside it is
#: UNK, and the tokenizer has already routed URLs, numbers and code elsewhere.
INPUT_ALPHABET = "abcdefghijklmnopqrstuvwxyz'- "

PAD, BOS, EOS, UNK = "<pad>", "<bos>", "<eos>", "<unk>"
SPECIAL_INPUTS = (PAD, BOS, EOS, UNK)

#: The empty label. Named rather than "" so it is visible in dumps and metrics.
EMPTY_LABEL = ""


@dataclass
class Vocab:
    """Bidirectional symbol <-> id map with a stable, sorted ordering."""

    symbols: list[str]
    index: dict[str, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.index = {s: i for i, s in enumerate(self.symbols)}

    def __len__(self) -> int:
        return len(self.symbols)

    def encode(self, symbol: str, default: int = 0) -> int:
        return self.index.get(symbol, default)

    def decode(self, idx: int) -> str:
        return self.symbols[idx]

    def to_json(self) -> list[str]:
        return list(self.symbols)

    @classmethod
    def from_json(cls, symbols: list[str]) -> "Vocab":
        return cls(list(symbols))


def input_vocab() -> Vocab:
    return Vocab(list(SPECIAL_INPUTS) + list(INPUT_ALPHABET))


def align_to_labels(chunks: list[Chunk]) -> tuple[str, list[str]]:
    """Convert aligned chunks into (latin string, one label per latin character).

    Chunks whose Latin side is empty have no character to attach to, so their
    Persian output is carried forward and prefixed onto the next character's
    label — producing the multi-character labels. A trailing one is appended to
    the final character instead, so nothing is ever dropped.
    """
    latin_parts: list[str] = []
    labels: list[str] = []
    pending = ""

    for chunk in chunks:
        if not chunk.latin:
            pending += chunk.fa
            continue
        latin_parts.append(chunk.latin)
        labels.append(pending + chunk.fa)
        labels.extend(EMPTY_LABEL for _ in chunk.latin[1:])
        pending = ""

    if pending:
        if labels:
            labels[-1] += pending
        else:
            latin_parts.append("")
    return "".join(latin_parts), labels


def labels_to_persian(labels: list[str]) -> str:
    return "".join(labels)


def build_label_vocab(
    label_streams: list[list[str]],
    *,
    min_count: int = 1,
    max_labels: int | None = None,
) -> tuple[Vocab, Counter]:
    """Collect the output label set, most frequent first after the specials.

    Rare labels are dropped to `min_count`: a label seen twice in a million
    words is memorization of a generator quirk, not a correspondence, and it
    costs an output-projection row (hidden x 1) to keep.
    """
    counts: Counter = Counter()
    for stream in label_streams:
        counts.update(stream)
    ordered = [lbl for lbl, n in counts.most_common() if n >= min_count]
    if max_labels is not None:
        ordered = ordered[:max_labels]
    if EMPTY_LABEL in ordered:
        ordered.remove(EMPTY_LABEL)
    # Index 0 is the empty label: it is by far the most frequent, and pinning it
    # makes padded positions and "delete this character" the same cheap default.
    symbols = [EMPTY_LABEL] + ordered
    return Vocab(symbols), counts


def save_vocabs(path: Path, inputs: Vocab, outputs: Vocab) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"input": inputs.to_json(), "output": outputs.to_json()}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def load_vocabs(path: Path) -> tuple[Vocab, Vocab]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return Vocab.from_json(payload["input"]), Vocab.from_json(payload["output"])

"""Synthetic corpus construction.

Takes the Persian lexicon, runs each word through the Finglish generator
several times with different spelling choices, and emits aligned per-character
training examples.

Splitting happens **by Persian word, before variants are generated**. Splitting
afterwards would put `emrooz` in train and `emruz` in test — the same word in
two spellings — and every reported number would be leakage. This is the single
easiest way to fool yourself on this task, and the plan calls it out.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .g2p import FinglishGenerator
from .labels import align_to_labels
from .lexicon import load as load_lexicon


@dataclass
class Example:
    latin: str
    labels: list[str]
    persian: str

    def to_json(self) -> dict:
        return {"latin": self.latin, "labels": self.labels, "persian": self.persian}


def split_of(word: str, dev_share: float = 0.05, test_share: float = 0.05) -> str:
    """Deterministic per-word split, stable across runs and corpus sizes."""
    digest = hashlib.sha256(word.encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    if bucket < test_share:
        return "test"
    if bucket < test_share + dev_share:
        return "dev"
    return "train"


def build(
    *,
    out_dir: Path,
    variants: int = 6,
    max_words: int | None = None,
    seed: int = 0,
    variant_rate: float = 0.30,
    max_length: int = 32,
) -> dict:
    """Generate the corpus and write one JSONL file per split."""
    words = load_lexicon()
    if max_words is not None:
        # Take a deterministic stride rather than a prefix: the lexicon is
        # alphabetical, so the first N words would all start with آ.
        stride = max(1, len(words) // max_words)
        words = words[::stride][:max_words]

    generator = FinglishGenerator(seed=seed, variant_rate=variant_rate)
    out_dir.mkdir(parents=True, exist_ok=True)
    handles = {name: (out_dir / f"{name}.jsonl").open("w", encoding="utf-8") for name in ("train", "dev", "test")}
    counts = {"train": 0, "dev": 0, "test": 0}
    skipped = 0

    try:
        for word in words:
            split = split_of(word)
            seen: set[str] = set()
            for _ in range(variants):
                chunks = generator.generate(word)
                latin, labels = align_to_labels(chunks)
                if not latin or latin in seen or len(latin) > max_length:
                    continue
                # The generator must be lossless: labels concatenate back to the
                # source word. A mismatch means a bug, not a hard example.
                if "".join(labels) != word:
                    skipped += 1
                    continue
                seen.add(latin)
                handles[split].write(
                    json.dumps(Example(latin, labels, word).to_json(), ensure_ascii=False) + "\n"
                )
                counts[split] += 1
    finally:
        for handle in handles.values():
            handle.close()

    manifest = {
        "words": len(words),
        "variants_requested": variants,
        "examples": counts,
        "dropped_misaligned": skipped,
        "seed": seed,
        "variant_rate": variant_rate,
        "max_length": max_length,
        "hash": corpus_hash(out_dir),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def corpus_hash(out_dir: Path) -> str:
    """Hash every split so metrics can name the exact data they came from."""
    digest = hashlib.sha256()
    for name in ("train", "dev", "test"):
        path = out_dir / f"{name}.jsonl"
        if path.exists():
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def read(path: Path) -> list[Example]:
    out = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            payload = json.loads(line)
            out.append(Example(payload["latin"], payload["labels"], payload["persian"]))
    return out

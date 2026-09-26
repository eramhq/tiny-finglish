"""Tensor batching for the transducer."""

from __future__ import annotations

import torch

from .corpus import Example
from .labels import EOS, PAD, Vocab

PAD_ID = 0
IGNORE_INDEX = -100


def encode_batch(
    examples: list[Example],
    inputs: Vocab,
    outputs: Vocab,
    *,
    device: torch.device | str = "cpu",
    marked: list[bool] | None = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Pad to the longest example in the batch and return (ids, targets).

    Padded target positions get IGNORE_INDEX so they contribute no loss. Note
    this is NOT the same as the empty label at index 0: "this character emits
    nothing" is a real prediction the model must learn, while "there is no
    character here" must not be trained on at all. Conflating them teaches the
    model that padding is a valid output and wrecks the end of every word.

    A `final` example — the word ends a clause — gets `<eos>` after its last
    character, so the last letters can see the clause end through the
    neighbourhood window and the backward scan (`ketabe<eos>` is کتابه, `ketabe`
    before `man` is the ezafe). The marker's own position is IGNORE_INDEX: the
    runtime decodes only the word's characters, so what the model predicts at
    `<eos>` is never read, and training it would only spend capacity.

    `marked` overrides which examples get the marker (`train.py`'s marker
    dropout); by default it is exactly the `final` ones.
    """
    if marked is None:
        marked = [bool(e.final) for e in examples]
    width = max(len(e.latin) + (1 if m else 0) for e, m in zip(examples, marked))
    unk = inputs.encode("<unk>")
    eos = inputs.encode(EOS)
    ids = torch.full((len(examples), width), inputs.encode(PAD), dtype=torch.long)
    targets = torch.full((len(examples), width), IGNORE_INDEX, dtype=torch.long)

    for row, example in enumerate(examples):
        for col, ch in enumerate(example.latin):
            ids[row, col] = inputs.encode(ch, unk)
        if marked[row]:
            ids[row, len(example.latin)] = eos
        for col, label in enumerate(example.labels):
            targets[row, col] = outputs.encode(label, 0)

    return ids.to(device), targets.to(device)


def length_bucketed(examples: list[Example], batch_size: int) -> list[list[Example]]:
    """Group by length so batches are dense.

    Words here are 2-20 characters; mixing them freely would pad most batches to
    twice their useful width, and the scan cost is linear in width.
    """
    ordered = sorted(examples, key=lambda e: len(e.latin))
    return [ordered[i : i + batch_size] for i in range(0, len(ordered), batch_size)]

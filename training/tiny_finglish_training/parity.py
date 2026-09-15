"""Generate the Python side of the CPU/browser parity fixtures.

Writes, for a set of fixed inputs, the exact logits the PyTorch model produces
**after quantization round-trip**. `scripts/parity.ts` feeds the same inputs
through `src/runtime.ts` and asserts the outputs agree within tolerance.

Quantized, not float, is the right reference: the browser will only ever see
dequantized weights, so pinning it to the float model would be pinning it to a
model that never ships.

    python -m tiny_finglish_training.parity \\
        --checkpoint runs/m2/100k/best.pt --out ../data/fixtures/parity.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from .export import export_model
from .labels import load_vocabs
from .model import ModelConfig, build

#: Inputs chosen to exercise every structural path: the empty label, multi-
#: character labels, the neighbourhood window at both edges, and lengths from 1
#: to past the point where the affine scan's state has saturated.
PARITY_INPUTS = [
    "a", "kh", "salam", "emrooz", "miram", "khahar", "ketab", "daneshgah",
    "mitavanam", "bozorgtar", "nemikonam", "khanevadeam", "sabr", "sabz",
    "chetori", "khoone", "doost", "aaaaaaaaaaaaaaaaaaaa",
    "abcdefghijklmnopqrstuvwxyz",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--vocab", type=Path, default=None)
    parser.add_argument("--weights", type=Path, required=True, help="where to write the artifact")
    parser.add_argument("--out", type=Path, required=True, help="where to write parity fixtures")
    parser.add_argument("--quant", choices=["int8", "int6"], default="int8")
    args = parser.parse_args()

    state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    config = ModelConfig.from_json(state["config"])
    model = build(config)
    model.load_state_dict(state["model"])
    model.eval()

    inputs, outputs = load_vocabs(args.vocab or args.checkpoint.parent / "vocab.json")
    artifact, shadow = export_model(model, inputs, outputs, quant=args.quant)

    args.weights.parent.mkdir(parents=True, exist_ok=True)
    args.weights.write_text(json.dumps(artifact, ensure_ascii=False), encoding="utf-8")

    unk = inputs.encode("<unk>")
    records = []
    with torch.no_grad():
        for text in PARITY_INPUTS:
            ids = [inputs.encode(ch, unk) for ch in text]
            logits = shadow(torch.tensor([ids], dtype=torch.long))[0]
            predicted = "".join(outputs.decode(int(i)) for i in logits.argmax(dim=-1))
            records.append({
                "input": text,
                "ids": ids,
                "shape": list(logits.shape),
                # float32 round-tripped through repr, so the JSON is exact to
                # the last bit rather than a rounded decimal.
                "logits": [float(v) for v in logits.flatten().tolist()],
                "predicted": predicted,
            })

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"{len(records)} parity fixtures -> {args.out}")
    print(f"weights -> {args.weights} ({args.weights.stat().st_size:,} bytes, {args.quant})")


if __name__ == "__main__":
    main()

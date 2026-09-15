"""Quantized export — the bridge to the browser runtime.

Produces one self-contained JSON artifact holding the config, both vocabularies,
per-row scales and the packed weights. `src/runtime.ts` reads exactly this.

Two payload encodings, because the plan says to start at int8 and evaluate
6-bit only once a correct baseline exists, and this script reports both so that
choice is made on measured bytes:

  int8  256 levels, payload is base64 of the raw bytes.
  int6   63 levels, payload is **one ASCII character per weight** from a
         63-symbol alphabet.

That second encoding looks wrong and is not. Measured on a comparable shipped
model, one-char-per-weight is 41,321 raw / 20,940 Brotli, while base64 of
bit-packed 6-bit codes is 55,096 raw / 27,903 Brotli — the ASCII form is 33%
*larger* before compression and 25% *smaller* after. Bit-packing smears each
value across byte boundaries and destroys the per-symbol regularity that
Brotli's context modelling exploits. Compressed size is what ships, so the
larger raw encoding wins.

Quantization is per output row, symmetric, with the row's own scale. Rows are
the natural unit: each output neuron has its own dynamic range, and a single
tensor-wide scale would let one large row crush the resolution of every other.
"""

from __future__ import annotations

import argparse
import base64
import json
from dataclasses import dataclass
from pathlib import Path

import torch

from .labels import load_vocabs
from .model import ModelConfig, Transducer, build

#: 63 symbols for int6. Chosen to be JSON-safe (no quote, no backslash) and
#: alphanumeric-dominant, which is the shape Brotli's context model handles best.
INT6_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-"[:63]

QMAX = {"int8": 127, "int6": 31}


@dataclass
class TensorRecord:
    name: str
    shape: list[int]
    kind: str  # "quantized" | "float32"
    scales: list[float] | None = None


def quantize_rows(tensor: torch.Tensor, qmax: int) -> tuple[torch.Tensor, torch.Tensor]:
    """Symmetric per-row quantization. Returns (codes in [-qmax, qmax], scales)."""
    flat = tensor.reshape(tensor.shape[0], -1).float()
    scales = flat.abs().amax(dim=1) / qmax
    # A dead row (all zeros) would divide by zero; give it any positive scale,
    # since every code in it is zero anyway.
    scales = torch.where(scales > 0, scales, torch.ones_like(scales))
    codes = torch.round(flat / scales[:, None]).clamp(-qmax, qmax).to(torch.int32)
    return codes, scales


def dequantize_rows(codes: torch.Tensor, scales: torch.Tensor, shape: torch.Size) -> torch.Tensor:
    return (codes.float() * scales[:, None]).reshape(shape)


def encode_payload(codes: torch.Tensor, quant: str) -> str:
    qmax = QMAX[quant]
    shifted = (codes + qmax).flatten().tolist()
    if quant == "int6":
        return "".join(INT6_ALPHABET[c] for c in shifted)
    return base64.b64encode(bytes(shifted)).decode("ascii")


def encode_float32(tensor: torch.Tensor) -> str:
    return base64.b64encode(tensor.float().contiguous().numpy().tobytes()).decode("ascii")


def export_model(
    model: Transducer,
    inputs,
    outputs,
    *,
    quant: str = "int8",
) -> tuple[dict, Transducer]:
    """Serialize `model` and return (artifact, a model with dequantized weights).

    The second return value is the point: evaluating it reproduces exactly what
    the browser will compute, so reported accuracy is the accuracy that ships
    rather than the accuracy of a model nobody can run.
    """
    if quant not in QMAX:
        raise ValueError(f"unknown quantization {quant!r}")
    qmax = QMAX[quant]

    records: list[dict] = []
    payload_parts: list[str] = []
    dequantized_state = {}

    for name, tensor in model.state_dict().items():
        if tensor.dim() >= 2:
            codes, scales = quantize_rows(tensor, qmax)
            payload_parts.append(encode_payload(codes, quant))
            records.append({
                "name": name,
                "shape": list(tensor.shape),
                "kind": "quantized",
                "scales": [round(float(s), 9) for s in scales],
            })
            dequantized_state[name] = dequantize_rows(codes, scales, tensor.shape)
        else:
            # Biases and norm gains: few in number, and their precision matters
            # disproportionately because they shift every output. Keep float32.
            payload_parts.append(encode_float32(tensor))
            records.append({"name": name, "shape": list(tensor.shape), "kind": "float32"})
            dequantized_state[name] = tensor.float()

    shadow = build(model.config)
    shadow.load_state_dict(dequantized_state)
    shadow.eval()

    artifact = {
        "format": "tiny-finglish-weights/1",
        "quant": quant,
        "alphabet": INT6_ALPHABET if quant == "int6" else "base64",
        "config": model.config.to_json(),
        "vocab": {"input": inputs.to_json(), "output": outputs.to_json()},
        "tensors": records,
        "payload": payload_parts,
    }
    return artifact, shadow


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--vocab", type=Path, default=None)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--quant", choices=sorted(QMAX), default="int8")
    args = parser.parse_args()

    state = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    config = ModelConfig.from_json(state["config"])
    model = build(config)
    model.load_state_dict(state["model"])
    model.eval()

    vocab_path = args.vocab or args.checkpoint.parent / "vocab.json"
    inputs, outputs = load_vocabs(vocab_path)

    artifact, _ = export_model(model, inputs, outputs, quant=args.quant)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, ensure_ascii=False), encoding="utf-8")

    raw = args.out.stat().st_size
    print(f"{args.out}  {raw:,} bytes raw  quant={args.quant}  params={model.parameter_count():,}")
    print("Run `node scripts/size.ts` for the Brotli figure that actually ships.")


if __name__ == "__main__":
    main()

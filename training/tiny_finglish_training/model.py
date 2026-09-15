"""The neural grapheme transducer — step [2] of the pipeline.

Shape follows `gpu-lexer`: learned character embeddings, a local neighbourhood
feature, then **bidirectional affine scans**, then a per-position projection to
the label set. An affine scan is a linear recurrence, so unlike a GRU or LSTM
it is parallelizable and — more important here — it is about thirty lines to
reimplement exactly in JavaScript.

Every choice below is made for **numerical parity** with `src/runtime.ts`,
because that is the milestone the plan says most directly serves the learning
goal. Specifically:

  * float32 everywhere; no TF32, no autocast.
  * RMSNorm rather than LayerNorm — no mean subtraction, one fewer reduction to
    match, and no epsilon-placement ambiguity.
  * ReLU rather than GELU — exactly representable, no erf/tanh approximation to
    disagree about.
  * The recurrence is written in **convex form**, ``h = a*h + (1-a)*b`` with
    ``a = sigmoid(.)`` in (0,1), so the state is bounded by max|b| instead of
    growing geometrically. Bounded activations are what make post-training
    quantization behave, and they keep the JS accumulation from drifting.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class ModelConfig:
    input_vocab: int
    output_vocab: int
    d_model: int = 64
    d_hidden: int = 96
    n_layers: int = 2
    #: Half-width of the neighbourhood feature. 2 means characters t-2..t+2,
    #: matching gpu-lexer's "five-part neighbourhood".
    context: int = 2

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, payload: dict) -> "ModelConfig":
        return cls(**payload)


class RMSNorm(nn.Module):
    """x * rsqrt(mean(x^2) + eps) * weight. Reimplemented verbatim in JS."""

    def __init__(self, dim: int, eps: float = 1e-5):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        scale = torch.rsqrt(x.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return x * scale * self.weight


class AffineScan(nn.Module):
    """One bidirectional affine-scan layer with a residual projection.

    The recurrence, per direction and per hidden channel::

        h[t] = a[t] * h[t-1] + (1 - a[t]) * b[t],   h[-1] = 0

    ``a = sigmoid(Wa x + ba)`` is a forget gate in (0,1) and ``b = Wb x + bb``
    is the candidate. Writing it convexly rather than as ``a*h + b`` matters:
    it makes ``|h| <= max|b|`` unconditionally, which is what keeps the int8
    export faithful and the JS scan from accumulating error over long inputs.
    """

    def __init__(self, d_model: int, d_hidden: int):
        super().__init__()
        self.d_hidden = d_hidden
        # One projection produces all four streams so the export has a single
        # contiguous tensor per layer and the JS side does one matmul.
        self.proj = nn.Linear(d_model, 4 * d_hidden)
        self.out = nn.Linear(2 * d_hidden, d_model)
        self.norm = RMSNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, _ = x.shape
        gates = self.proj(x)
        a_f, v_f, a_b, v_b = gates.split(self.d_hidden, dim=-1)
        a_f = torch.sigmoid(a_f)
        a_b = torch.sigmoid(a_b)

        h_f = _scan(a_f, v_f, reverse=False)
        h_b = _scan(a_b, v_b, reverse=True)

        y = self.out(torch.cat([h_f, h_b], dim=-1))
        return self.norm(x + y)


def _scan(a: torch.Tensor, v: torch.Tensor, *, reverse: bool) -> torch.Tensor:
    """Sequential convex scan over the time axis.

    Kept as an explicit loop rather than a log-space parallel scan. The parallel
    form needs ``cumprod`` of gates in (0,1), which underflows within a few
    dozen steps and then divides by the underflowed value — numerically hostile
    at exactly the precision we are trying to hold steady across two languages.
    Inputs here are words and short sentences, so the loop is cheap; see
    ``docs/benchmarks.md`` for the measured MPS-versus-CPU tradeoff.
    """
    steps = range(a.shape[1] - 1, -1, -1) if reverse else range(a.shape[1])
    h = torch.zeros(a.shape[0], a.shape[2], dtype=a.dtype, device=a.device)
    out = []
    for t in steps:
        h = a[:, t] * h + (1.0 - a[:, t]) * v[:, t]
        out.append(h)
    if reverse:
        out.reverse()
    return torch.stack(out, dim=1)


class Transducer(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__()
        self.config = config
        self.embed = nn.Embedding(config.input_vocab, config.d_model)
        width = 2 * config.context + 1
        self.neighbourhood = nn.Linear(width * config.d_model, config.d_model)
        self.layers = nn.ModuleList(
            AffineScan(config.d_model, config.d_hidden) for _ in range(config.n_layers)
        )
        self.head = nn.Linear(config.d_model, config.output_vocab)
        self.apply(_init)

    def forward(self, ids: torch.Tensor) -> torch.Tensor:
        """ids: [B, T] int64 -> logits: [B, T, output_vocab]."""
        x = self.embed(ids)
        x = F.relu(self.neighbourhood(_stack_neighbourhood(x, self.config.context)))
        for layer in self.layers:
            x = layer(x)
        return self.head(x)

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def reachable_parameter_count(self, used_input_ids: set[int] | None = None) -> int:
        """Parameters that can actually influence a browser prediction.

        `gpu-lexer` reports 41,321 *reachable* weights rather than raw parameter
        count, because embedding rows for symbols the tokenizer can never emit
        are dead weight that the export drops. Quoting the raw number would
        overstate both the model and the download.
        """
        total = self.parameter_count()
        if used_input_ids is None:
            return total
        dead_rows = self.config.input_vocab - len(used_input_ids)
        return total - dead_rows * self.config.d_model


def _stack_neighbourhood(x: torch.Tensor, context: int) -> torch.Tensor:
    """Concatenate embeddings at offsets -context..+context, zero-padded."""
    shifts = []
    for offset in range(-context, context + 1):
        if offset == 0:
            shifts.append(x)
        else:
            shifted = torch.roll(x, shifts=-offset, dims=1)
            # roll wraps; zero the wrapped edge so position t never sees the
            # opposite end of the sequence.
            if offset > 0:
                shifted[:, -offset:, :] = 0
            else:
                shifted[:, :-offset, :] = 0
            shifts.append(shifted)
    return torch.cat(shifts, dim=-1)


def _init(module: nn.Module) -> None:
    if isinstance(module, nn.Linear):
        nn.init.normal_(module.weight, std=0.02 / math.sqrt(2))
        if module.bias is not None:
            nn.init.zeros_(module.bias)
    elif isinstance(module, nn.Embedding):
        nn.init.normal_(module.weight, std=0.02)


def build(config: ModelConfig) -> Transducer:
    torch.set_float32_matmul_precision("highest")
    return Transducer(config)

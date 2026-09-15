# Benchmarks

All figures measured on an Apple M-series laptop, Node 24. Reproduce with
`node scripts/bench.ts` and `node scripts/size.ts`.

## Latency — the primary budget

The plan's central reframing: **budget latency, not size**. A 250 KiB Brotli
download is one medium JPEG, paid once and then HTTP-cached. A keystroke that
misses a frame is paid on every character, forever.

| workload | measured | budget | |
|---|---:|---:|---|
| cold init (decode + unpack weights) | ~25 ms | — | |
| keystroke, incremental word | < 0.01 ms | 16 ms | ok |
| keystroke, end of sentence, warm cache | 0.02 ms | 16 ms | ok |
| sentence, cold cache | ~22 ms | 100 ms | ok |
| paragraph, ~640 chars, warm | 0.12 ms | — | |

Enforced in CI. A build that exceeds either budget fails.

The typing path never re-runs the whole sentence: conversion is word-by-word
with a word-level memo, so a keystroke costs one word. The plan predicted
~1–2 ms for a six-character word in plain JS; the measured figure is well under
that because the memo absorbs repeated prefixes.

## Size — the secondary budget

| component | raw | gzip | Brotli |
|---|---:|---:|---:|
| runtime + rules + tokenizer (JS) | 26.1 KiB | 10.3 KiB | **9.1 KiB** |
| model weights, int6, 102,348 params | 120.5 KiB | 82.1 KiB | **76.0 KiB** |
| word frequency, 25k words | 119.9 KiB | — | **54.2 KiB** |
| **shipped total** | | | **139.3 KiB** |
| word bigrams, 30k pairs (optional, not shipped by default) | | | 73.6 KiB |
| lexicon, 100,761 stems (optional, not shipped by default) | | | 98.3 KiB |

Soft cap is ~250 KiB Brotli; the current build uses 56% of it.

The data rows are already Brotli on disk and are reported as-is rather than
double-compressed. None is bundled: all are separate fetches, so a consumer who
wants the rules alone pays 6.7 KiB via `tiny-finglish/rules`.

### Accuracy per byte, which is what decides what ships

| artifact | Brotli | gold gain, rules | KiB per point |
|---|---:|---:|---:|
| word frequency | 54.2 KiB | +6.1 | **8.9** |
| word bigrams | 73.6 KiB | +0.9 | **81.8** |
| model weights | 76.0 KiB | −11.1 | negative |

Frequency ships. The bigram is built, committed and measured but opt-in, at nine
times the cost per point. The model ships because it wins ZWNJ, adversarial
input and mixed English — categories the headline average hides — and not
because it wins the average, which it does not.

### Quantization actually matters at scale

| model | quant | raw | Brotli | bits/param |
|---|---|---:|---:|---:|
| 30k | int8 | 48.0 KiB | 31.6 KiB | 9.35 |
| 100k | int6 | 120.5 KiB | **75.8 KiB** | 6.06 |
| 100k | int8 | 158.3 KiB | 106.5 KiB | 8.51 |
| 500k | int6 | 582.1 KiB | **368.3 KiB** | 5.57 |
| 500k | int8 | 757.2 KiB | 538.6 KiB | 8.15 |

**int6 is ~30% smaller than int8 after Brotli**, for no measurable accuracy cost
(see the M2 curve: int6 and int8 land within 0.1 points of float32 at every
size). The int6 payload is *one ASCII character per weight*, which is larger
than bit-packing before compression and smaller after it.

This is what decides the shipped configuration: 500k busts the 250 KiB cap at
both quantization levels, while 100k at int6 leaves room for the frequency and
bigram tables and still lands at 85% of it. Reported on every build, never an automatic
failure — the dominant risk to adoption is a model too small to spell common
words correctly, not a download one JPEG larger.

The JS runtime at 8.9 KiB Brotli confirms the expectation that weights dominate
the payload and hand-written inference code is a rounding error. What the
original expectation missed is that *data* dominates the weights: frequency and
bigrams together are 127.8 KiB against the model's 76.0 KiB, and they buy far
more accuracy per byte.

## Training device

The plan flags PyTorch MPS kernel-launch overhead as a risk for tiny tensors.
Measured at d_model 64, d_hidden 96, 2 layers, batch 512:

| device | ms/step |
|---|---:|
| cpu | 23 |
| mps | 28 |

**CPU wins.** The affine scan issues one kernel per timestep per direction per
layer, so a 20-character word costs ~80 launches per forward, and at this tensor
size launch overhead dominates the arithmetic. `--device auto` therefore selects
CUDA when present and CPU otherwise; MPS is opt-in via `--device mps`.

Corpus generation is not the bottleneck either: 105,000 aligned examples build
in 1.6 s, and the full 533,518-example corpus in about 8 s.

# Benchmarks

All figures measured on an Apple M-series laptop, Node 24. Reproduce with
`node scripts/bench.ts` and `node scripts/size.ts`.

## Latency — the primary budget

The plan's central reframing: **budget latency, not size**. A 250 KiB Brotli
download is one medium JPEG, paid once and then HTTP-cached. A keystroke that
misses a frame is paid on every character, forever.

| workload | measured | budget | |
|---|---:|---:|---|
| cold init (decode + unpack weights, build dictionary index) | ~34 ms | — | |
| keystroke, incremental word | < 0.01 ms | 16 ms | ok |
| keystroke, end of sentence, warm cache | 0.02 ms | 16 ms | ok |
| sentence, cold cache | ~36 ms | 100 ms | ok |
| paragraph, ~640 chars, warm | 0.12 ms | — | |
| one uncached word, rule engine with dictionary | 0.11 ms mean, ~1 ms worst | — | |

The cold figures rose from ~25 and ~22 ms when the rule engine gained its
skeleton dictionary (`src/dictionary.ts`), which indexes the 25k-word frequency
table at construction: 15.6 ms, down from 31 ms before its buckets were sorted
individually instead of as one 25k-entry sort. The uncached-word row is the one
the keystroke gate cares about when the memo misses: 1,732 distinct dev-set
words average 0.11 ms each.

Enforced in CI. A build that exceeds either budget fails.

The typing path never re-runs the whole sentence: conversion is word-by-word
with a word-level memo, so a keystroke costs one word. The plan predicted
~1–2 ms for a six-character word in plain JS; the measured figure is well under
that because the memo absorbs repeated prefixes.

## Size — the secondary budget

| component | raw | gzip | Brotli |
|---|---:|---:|---:|
| runtime + rules + tokenizer + dictionary + fitted channel (JS) | 39.6 KiB | 14.6 KiB | **12.9 KiB** |
| model weights, int6, 110,018 params | 131.0 KiB | 89.1 KiB | **83.7 KiB** |
| word frequency, 25k words | 119.9 KiB | — | **54.1 KiB** |
| **shipped total** | | | **150.7 KiB** |
| word bigrams, 30k pairs (optional, not shipped by default) | | | 73.6 KiB |
| lexicon, 100,761 stems (optional, not shipped by default) | | | 98.3 KiB |

Soft cap is ~250 KiB Brotli; the current build uses 60% of it. The weights
grew 7.7 KiB when the retrained model's label set grew (ع-bearing labels the
old generator never produced), and the JS 3.8 KiB for the dictionary, the
morphology module (off) and the 1 KiB fitted channel table.

The data rows are already Brotli on disk and are reported as-is rather than
double-compressed. None is bundled: all are separate fetches, so a consumer who
wants the rules alone pays 6.7 KiB via `tiny-finglish/rules`.

### Accuracy per byte, which is what decides what ships

| artifact | Brotli | gold gain, rules | KiB per point |
|---|---:|---:|---:|
| word frequency | 54.2 KiB | +6.1 | **8.9** |
| word bigrams | 73.6 KiB | +0.9 | **81.8** |
| model weights | 76.0 KiB | −11.1 | negative |
| fitted channel table (Sept 2026) | 1.0 KiB | +0.8 on dev | **1.2** |

The first three rows are as measured when they were decided, on the 1,835-row
gold before its audit. The fitted channel's row is measured on dev, the tuning
surface. The retrained model is still negative on its own (69.2% against the
rules' 73.5% on audited gold), and adds orthographic accuracy only as a feature
in the hybrid.

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

## Which past differences were real

Nothing in the repo tested significance until `scripts/ab.ts` (September 2026).
It scores two engine configs on the same rows and runs a paired bootstrap over
rows (sentences, not words, since the words of one sentence are not independent;
2,000 resamples, seed 42, `scripts/_stats.ts`). A difference is **real** when
its 95% CI excludes 0. Each past decision was re-read with it, on today's
engine (loanwords, texting skeletons and the `-o` marker included), so the
point values differ slightly from those quoted when the decisions were made.

| comparison | set | b − a, points | 95% CI | rows b / a / tied | verdict |
|---|---|---:|---|---|---|
| v7 → v8-sentence | dev, strict | +1.0 | +0.1 to +1.7 | 61 / 26 / 217 | real |
| v7 → v8-sentence | chat-dev, strict | +3.3 | +1.1 to +5.6 | 39 / 18 / 143 | real |
| v7 → v8-sentence | chat-dev, accepted | +2.6 | +1.0 to +4.3 | 36 / 14 / 150 | real |
| v8-sentence → v8b | dev, strict | −0.3 | −0.9 to +0.3 | 29 / 36 / 239 | within noise |
| v8-sentence → v8b | fixtures, strict | −0.5 | −2.6 to +1.5 | 5 / 8 / 228 | within noise |
| v8-sentence → v8b | chat-dev, strict | +1.7 | +0.2 to +3.0 | 25 / 10 / 165 | real, barely |
| v8-sentence → v8b | chat-dev, accepted | +1.5 | +0.1 to +2.9 | 25 / 12 / 163 | real, barely |
| rules → hybrid | gold, strict | −1.4 | −2.2 to −0.7 | 318 / 355 / 996 | real |
| rules → model | gold, strict | −1.9 | −2.8 to −1.1 | 393 / 477 / 799 | real |

What this changes:

* **v8 over v7 holds up** on both tuning surfaces, so shipping v8 was not luck.
* **v8b's "losses" were noise.** Its −0.3 on dev is about ten words net and
  its −0.5 on fixtures is two, both with CIs well across 0. Its chat-dev gain
  is the only real movement, and its lower bound is +0.1. v8b was held back for
  `ketabe` and for writing دانشجوهه, which are real defects; the dev and
  fixture drops were never evidence against it.
* **The gold ranking is real.** On the 1,669 scored gold rows the rules tier
  (with frequency and vowels) beats both the model and the hybrid by more than
  the noise. The model is shipped for the categories the average hides
  (above), not for the average.

Reproduce any row with, for example:

```bash
node scripts/ab.ts --dev --a "weights=training/runs/v7/weights.json" --b "weights=training/runs/v8-sentence/weights.json"
node scripts/ab.ts --chat --tier accepted --a "weights=training/runs/v8-sentence/weights.json" --b "weights=training/runs/v8b-sentence/weights.json"
node scripts/ab.ts --gold --a rules --b hybrid
```

`run-fixtures.ts` also prints the strict headline's own 95% CI. On dev (304
rows) it is about ±2.6 points wide, so two single-engine numbers that differ by
less than that say nothing without the paired test.

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

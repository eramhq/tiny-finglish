# Model card — tiny-finglish transducer

## Overview

A character-level grapheme transducer that converts Finglish (Persian written in
Latin/ASCII) to Persian script. One label per input character, drawn from a
Persian grapheme set that includes an empty label and multi-character labels.

| | |
|---|---|
| Task | monotonic transliteration, Latin → Perso-Arabic |
| Architecture | embedding → 5-wide neighbourhood → bidirectional affine scans → per-position softmax |
| Sizes trained | 27,660 / 102,348 / 541,516 / ~2M parameters |
| **Shipped** | **102,348 parameters, int6, 83.8 KiB Brotli with runtime** |
| Quantization | per-row symmetric int8 or int6 |
| Runtime | hand-written JavaScript, CPU, no WASM/WebGPU/ONNX |
| License | MIT (weights and code) |

## Intended use

Typing aids, search boxes, chat inputs, and editors for people without a Persian
keyboard. It is designed to be **inspectable and correctable**: every span
returns alternatives with probabilities, and confidence is exposed so a caller
can abstain rather than silently guess.

## Out of scope

Not a translator, not a chatbot, not a general LLM. Not intended for
unsupervised bulk rewriting of documents — the plan lists "silent rewriting of
long documents" as an explicit non-goal, and the accuracy figures below are why.

## Training data

**Synthetic.** Generated from the Lilak Persian stem list (Apache-2.0, 100,761
stems) by a rule-based Persian → Finglish generator that samples spelling
variation (`oo`/`u`, `ee`/`i`, `kh`/`x`, `gh`/`q`, joined/split forms).

| | |
|---|---|
| Corpus | 533,518 aligned examples from 100,761 words |
| Split | by Persian **word**, before variants are generated |
| Train / dev / test | 479,877 / 26,716 / 26,925 |
| Corpus hash | `c7e7c9130373543c` |

Splitting by word before variant generation is load-bearing: splitting
afterwards would put `emrooz` in train and `emruz` in test — the same word in
two spellings — and every number below would be leakage.

## Evaluation

Held-out **words**, not held-out spellings.

| size | params | word acc | int8 | int6 | + lexicon | lexicon gain |
|---|---:|---:|---:|---:|---:|---:|
| 30k | 27,660 | 0.8206 | 0.8204 | 0.8215 | 0.8719 | +0.0513 |
| 100k | 102,348 | 0.8535 | 0.8533 | 0.8527 | 0.8955 | +0.0420 |
| 500k | 541,516 | 0.8753 | 0.8754 | 0.8743 | 0.9066 | +0.0312 |

With the shipped 100k model:

| set | top-1 | top-3 | CER |
|---|---:|---:|---:|
| synthetic held-out words | 85.4% | — | — |
| hand-authored fixtures (n=174) | 66.1% | 79.9% | 0.104 |
| untouched gold (n=71) | 47.9% | 62.0% | 0.140 |

Copy-span preservation is 100% on every set that contains one.

**The gap between 85% and 48% is the number to trust the least and think about
the most.** Worse: going from 27k to 100k parameters moved the synthetic number
+3.3 points and the gold number −1.4 (one example, i.e. flat). The model is
demonstrably getting better at inverting the generator and not demonstrably
better at the task.

## Limitations

1. **Short vowels are guessed in training data.** Persian is an abjad, and no
   redistributable Persian pronunciation dictionary exists. The consonant and
   long-vowel skeleton is faithful; short-vowel quality is sampled.
2. **No frequency ranking.** Lexicon membership cannot separate `سلام` from
   `سلم` — both are real words.
3. **No language model.** Sentence-level context is where the remaining accuracy
   lives: on the closest measured analogue, context is worth ~21 WER points
   while architecture choice is worth under one.
4. **Register.** The lexicon is a spell-checker stem list, not chat Persian.
   Finglish users write `میرم`, not `می‌روم`.
5. **ZWNJ.** 33% placement accuracy on fixtures. Human writers manage ~83%.
6. **Evaluation is author-written.** Not collected from native speakers typing
   naturally.

## Ethical and practical notes

* **Privacy by construction.** Inference is local; no text leaves the browser
  and the package makes no network request.
* **It will be wrong, and it says so.** Confidence and alternatives are part of
  the contract precisely so that callers do not present output as certain.
* **Bias toward the lexicon's register.** Formal and standard spellings are
  favoured over colloquial ones, which is the opposite of what Finglish users
  mostly write.

## Reproducing

```bash
cd training
.venv/bin/python -c "from tiny_finglish_training.corpus import build; \
  from pathlib import Path; build(out_dir=Path('corpora/full'), variants=6, seed=0)"
.venv/bin/python -m tiny_finglish_training.sweep --corpus corpora/full --out runs/m2
```

Every reported score names the model artifact hash and dataset hash; see
`scripts/run-fixtures.ts` output and `training/runs/m2/curve.json`.

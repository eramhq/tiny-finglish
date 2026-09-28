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
| **Shipped** | **111,058 parameters (v8), int6, 98.2 KiB Brotli with runtime** (same 100k architecture; the label set grew) |
| Shipped data | 55.3 KiB word frequency and 13.3 KiB vowels, fetched separately — 173.3 KiB all in |
| Optional data | 73.6 KiB word bigrams, 98.3 KiB lexicon; measured, not shipped |
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

## The shipped model, as of September 2026 (v8)

**v8 is v7's recipe with a chat round added and one change to the mix.**
1,701 chat sentences (700 HomoRich lines containing a chat word, 1,001
LLM-written chat lines reviewed by two families), typed by luna with the same
personas, take the corpus to 14,660 sentences and 224,876 aligned examples.
LLM examples are now assigned to train/dev/test by sentence id rather than by
Persian word (`mix --llm-split sentence`): the per-word split had been holding
every typed example of خوبی and چطوره out of training. `docs/llm-work.md` §8.

| set | v7 | **v8, shipped** |
|---|---:|---:|
| dev set, strict | 57.1% | **58.0%** |
| dev set, against `faithful` | 67.9% | **68.9%** |
| hand-authored fixtures (227, with 16 chat rows) | 90.2% | **92.2%** |
| chat-dev, closest accepted spelling (200, **AI-typed**) | 84.1% | **87.0%** |
| **gold, scored once (1,669 audited rows)** | 71.1% | **72.4%** |
| gold, orthographic tier | 75.9% | **77.0%** |
| chat-test, strict (100, **AI-typed**, scored once) | 75.4% | **79.0%** |

Both columns use the same shipped scoring (this round's engine), so they differ
only in the weights. Parity with the PyTorch checkpoint: 1.8e-5 against 2e-3.

**Known misses it ships with.** `ketabe` alone is written کتاب, not کتابه: the
model prefers the ezafe reading 81/19 after the clause-final tilt. The round's
ship rule required کتابه on every tier; it ships without it by decision, and a
follow-up copula round (v8b) that moved it to 60/40 was not shipped because it
started writing دانشجوهه. Its dev loss (−0.3) was noise, as `scripts/ab.ts`
later showed (`docs/benchmarks.md`). A clause-end marker trained into v8's
`<eos>` row alone (v8-eos) flips `ketabe` but writes بچهه and روسته, so it
was not shipped either (`docs/llm-work.md` §8). v8 scores lower than v7 on
the ZWNJ fixtures (77.8% vs 92.6%) and the ambiguous ones (88.9% vs 94.4%),
but these are 18-row categories. The ZWNJ gap is two words, one of which
changes with the training seed (`docs/open-items.md`).

## v7, as of the vowel-agreement round

Same architecture and recipe as the 100k model below, retrained on a new mix.
The rest of this card below this section is the record of how earlier models
were chosen and measured, kept as it was measured.

**Training data: half synthetic, half LLM-typed.**

* The synthetic corpus below, regenerated after fixing a generator bug. The bug
  wrote the Persian letters ع ئ ء ؤ into the Latin side of 21,008 of 425,590
  examples: 428,721 train examples, corpus hash `fd659baf6593debb`.
* 207,899 word-level examples from 12,971 HomoRich sentences (CC0), each typed
  in Finglish by calibrated LLM "typist" personas (Claude Opus 5 subagents and
  Codex GPT-5.6 luna), aligned to character labels by the rule engine's noisy
  channel and repeated to equal the synthetic count (`upsample 0.5`). 2,922 of
  the sentences are a targeted draw that ends in a ه word, because written
  Persian spells the copula است and people type it as a ه. Gold and dev
  sentences were excluded before sampling. See `docs/llm-work.md` §6 and
  `data/provenance/distill.json`.

**Evaluation.** Parity with the PyTorch checkpoint holds at 1.9e-5 against a
2e-3 tolerance. Both columns use the scoring shipped with v7 — frequency, the
vowel-agreement term and `heBorrow` (since removed) — so they differ only in the weights:

| set | v6 (10,049 sentences) | **v7 (12,971)** |
|---|---:|---:|
| dev set, strict (304 real rows, the tuning surface) | 56.4% | **57.0%** |
| dev set, against `faithful` | 67.4% | **67.8%** |
| hand-authored fixtures (211) | 91.2% | **93.7%** |
| **real human Finglish, gold (1,669 audited rows)** | 70.6% | **71.2%** |
| gold, orthographic tier | 75.5% | **75.9%** |

**v7 was held back one round over one word.** Without the vowel term it wrote
`salam` as سالم ("healthy") in every context: the LLM corpus never contains the
string `salam` — سلام is typed `salaam` every time — so the model generalized
from `salem`/`saalem`. The vowel table (`src/vowels.ts`) fixes that by ranking,
without retraining, and `test/vowels.test.ts` now pins `salam` on every tier.
The one adversarial fixture it still misses is `aaaaaaa`, one ا short.

**It still trails the rule engine on real input**, 71.2% to 74.3% strict on
gold. It leads on the fixtures (93.7% against 87.8%) and on ZWNJ (10 of 15
against 0 of 11). Ranked jointly with the rules (`hybrid: true`), it gives the
best orthographic-tier score in the project, 76.9% on gold — though on hybrid
gold strict v6 would score 72.2% to v7's 72.1%.

**Dataset size is no longer the lever it looked like.** `mix()` upsamples the
LLM half to match the synthetic count, so the training set is ~857k examples
whatever the corpus size, and uniform data only buys less repetition. Targeted
data is what moved v7: +9.1 on the fixtures' ezafe bucket and +11.1 on ZWNJ.
`docs/llm-work.md` §6 has the curve and its noise.

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

With the shipped 100k model, reporting **word accuracy** (the metric the
literature uses; sentence exact-match collapses to ~3% on 8-word sentences and
stops discriminating):

| set | n | word acc | sentence |
|---|---:|---:|---:|
| synthetic held-out words | 23,933 | 80.9% | — |
| hand-authored fixtures | 193 | 78.9% | 74.1% |
| **real human Finglish** | **1,835** | **51.2%** | 3.9% |

Copy-span preservation is 100% on every set that contains one.

**51.2% is the number to quote for this model.** The others are measured
against data this project generated or wrote.

That last row read 46.8% over 1,906 rows before this round of work, and **the
weights did not change**. It moved for two reasons, both scoring corrections:

| | points |
|---|---:|
| punctuation folded on both sides in `src/metrics.ts` | +3.2 |
| 71 content-mismatched gold rows quarantined | +1.2 |

Neither is an improvement. The evidence that they are corrections rather than
uniform inflation is that the author-written sets barely moved under the same
change (+0.54 on the fixtures, +0.00 on `authored.jsonl`) while the collected
one moved +3.2: the sets this project wrote were written with clean
tokenization and the collected one was not. The README has the full table.

A further **+1.4** is available from the 30k-pair word bigram in
`sentencePass()`, which is built, committed and measured but **not shipped by
default**: 73.6 KiB for +1.4 points is 53 KiB per point on this configuration
and 82 on the rule baseline, against 8.9 for the frequency table. Enable it with
`node scripts/run-fixtures.ts --bigram`; `bigramGain` in
`data/results/comparison.json` publishes what it buys for every configuration.

**But the rule baseline beats it on real input**, 62.3% to 51.2%, using no
model at all. The shipped default is still the model because it wins on ZWNJ,
adversarial input and mixed English — see the README — but anyone choosing on
real-world accuracy alone should choose the rules. `data/results/comparison.json`
has both against every other implementation that exists.

Three negative results are worth more than the headline. All three predate the
frequency table and are quoted at the numbers measured at the time:

1. **Scaling did not transfer.** 27k → 100k parameters moved the synthetic
   number +3.3 points and the real number not at all.
2. **Fixing the generator did not transfer either.** Correcting the spelling
   distribution from measured real data (`x` at 0.1% not 30%, and so on)
   bought +5.2 points on the hand-authored fixtures, +9.6 on the author-written
   set, and **−0.3** on real human Finglish.

3. **Adding a real pronunciation dictionary made it worse**, monotonically:
   74.8% / 69.6% / 65.2% on fixtures at 0% / 75% / 100% pronunciation use, and
   44.6% / 41.2% / 37.7% on real Finglish. Correcting the short vowels cut
   spelling diversity from 4.72 to 4.09 per word, and the diversity was what
   made the model robust.

All three point the same way: the synthetic corpus is not the binding
constraint.

What is binding was then measured directly rather than inferred, with
`scripts/oracle.ts`. Over the 1,057 gold sentences whose spans align one-to-one
with the reference, at `candidatesPerSpan: 8`:

| engine | top-1 | oracle best-of-8 | recoverable by reranking | never proposed |
|---|---:|---:|---:|---:|
| rules + frequency | 68.8% | 79.1% | **+10.3 pts** | **20.9%** |
| model + frequency | 60.9% | 74.8% | +13.9 pts | 25.2% |

A sentence-context model is a reranker, so +9.6 points is its ceiling with a
perfect one. The bigger bucket is candidates that are never generated, which no
reranker can reach. The prior art's 21-point context gain was measured on top
of a pair 6-gram FST — a ranking-limited system — and does not transfer to a
recall-limited one.

Both were then built. Candidate generation first: a per-unit segmentation prior
in `RuleBaseline.walk()` and a wider beam, worth +1.0 to the rules and nothing
to the model, at **zero bytes**, and moving never-proposed from 20.9% to 20.3%.
Then a 30,000-pair word bigram decoded by Viterbi in `sentencePass()`, worth
**+1.4 to the model and +0.9 to the rules** for 73.6 KiB — which is why the
first ships and the second is opt-in.

`scripts/oracle.ts --misses` explains why neither went further, and it is the
most useful number in this card. Of the reference words never proposed, 48%
differ in *register* — the annotator typed formal Finglish over a colloquial
Persian original — 31% sit in rows whose two sides do not correspond word for
word, 13% differ only in a long vowel and 8% carry an ع that Finglish does not
write. **Under 1% differ only by a homophone letter class.** Almost none of the
remaining bucket is reachable by generating more candidates or ranking them
better, because the information needed is not in the input.

## Limitations

1. **Short vowels are guessed in training data.** Persian is an abjad, and no
   redistributable Persian pronunciation dictionary exists. The consonant and
   long-vowel skeleton is faithful; short-vowel quality is sampled.
2. **The language model is a bigram, it is opt-in, and it is nearly spent.**
   30,000 pairs, 73.6 KiB, +1.4 points — 53 KiB per point, against 8.9 for the
   frequency table, which is why it is not in the default download. A perfect
   reranker would be worth +9.6 and a trigram would cost several times the
   bytes for a fraction of that remainder. The prior art's "context is worth
   ~21 WER points" was measured on a system whose candidate generator was a
   pair 6-gram FST; it does not transfer here.
3. **Register is the binding constraint, and it is in the data.** The lexicon
   is a spell-checker stem list, not chat Persian — Finglish users write `میرم`,
   not `می‌روم` — and the gold set compounds it: its annotator typed *formal*
   Finglish over *colloquial* Persian originals in at least 5.4% of rows, which
   no transliterator can recover because the information is not in the input.
   48% of never-proposed words are this.
4. **ZWNJ.** 56.3% placement accuracy on fixtures with the model, 0% without
   it — rule tables structurally cannot emit U+200C. Human writers manage ~83%.
   The gold set cannot measure this: its Persian side carries no ZWNJ at all.
5. **Evaluation is one annotator.** Real typing, but a single writer's habits,
   in read-aloud register, for a text-to-speech project. `data/gold/README.md`
   has the panel protocol that would fix it.

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

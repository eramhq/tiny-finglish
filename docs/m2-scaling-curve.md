# M2 scaling curve

Corpus: 100,761 words, 479,877 train / 26,925 test
examples, hash `c7e7c9130373543c`.

| size | params | labels | test word acc | int8 | int6 | + lexicon | lexicon gain |
|---|---:|---:|---:|---:|---:|---:|---:|
| 30k | 27,660 | 76 | 0.8206 | 0.8204 | 0.8215 | 0.8719 | +0.0513 |
| 100k | 102,348 | 76 | 0.8535 | 0.8533 | 0.8527 | 0.8955 | +0.0420 |
| 500k | 541,516 | 76 | 0.8753 | 0.8754 | 0.8743 | 0.9066 | +0.0312 |

Evaluated on held-out **words**, not held-out spellings: the split is by Persian
word before variants are generated, so no test word appears in training under
any spelling.

## What the curve says

**1. Accuracy rises and decelerates.** +3.3 points from 30k to 100k, +2.2 from
100k to 500k, for 3.7x and 5.3x the parameters respectively. The curve has not
flattened, but it is bending.

**2. Quantization is free.** int8 and int6 land within 0.1 points of float32 at
every size — well inside run-to-run noise. So the quantization choice is decided
purely on bytes, and int6 is ~30% smaller after Brotli.

**3. The lexicon gain shrinks monotonically: +5.1 -> +4.2 -> +3.1 points.**

That third row is the milestone's actual question. The plan's position going in
was that the model would absorb Persian orthography and the lexicon would stay a
training and evaluation artifact rather than a runtime dependency. The trend
supports it: every time the model grows, the lexicon has less left to contribute.

**Decision: the lexicon does not ship at runtime.** The snap tier (`src/decode.ts`,
`snapToLexicon`) is built and tested but `useLexiconSnap` defaults to `false`.

## What selects the shipped model

Not accuracy — the size cap.

| model | quant | weights Brotli | + runtime | vs 250 KiB cap |
|---|---|---:|---:|---|
| 30k | int8 | 31.6 KiB | 39.6 KiB | ok (16%) |
| **100k** | **int6** | **75.8 KiB** | **83.8 KiB** | **ok (34%)** |
| 100k | int8 | 106.5 KiB | 114.5 KiB | ok (46%) |
| 500k | int6 | 368.3 KiB | 376.3 KiB | over by 126 KiB |
| 500k | int8 | 538.6 KiB | 546.6 KiB | over by 297 KiB |

500k is the most accurate model trained and it exceeds the cap at both
quantization levels. **100k at int6 is the shipped configuration** — inside the
roadmap's predicted 100k-500k band, at its lower end.

## The 2M point was not run

Deliberately abandoned after ~55 minutes of training, for two reasons:

1. **It could not change any decision.** At the measured ~5.6 bits/parameter for
   int6, a 2M model is roughly 1.4 MB Brotli — about 5.6x the size cap. It was
   already excluded before it finished.
2. It was putting the machine under memory pressure.

The three points that exist establish both trends the milestone needed: where
accuracy bends, and that the lexicon contribution decays. A fourth point five
times over budget would have confirmed the shape without changing the outcome.

To run it anyway:

```bash
cd training
.venv/bin/python -m tiny_finglish_training.sweep \
    --corpus corpora/full --out runs/m2 --only 2M
```

## Caveat that outranks everything above

These are **synthetic** numbers — held-out words from a corpus this project
generated. On the untouched gold set, moving from 27k to 100k parameters bought
**nothing** (49.3% -> 47.9%, one example out of 71).

So the curve measures how well each model inverts the generator. Whether that
transfers to real Finglish is not established here, and the gold set says it may
not. See `data/gold/README.md`.

# tiny-finglish

Convert **Finglish** — Persian typed in Latin/ASCII — into Persian script,
entirely in the browser. No server, no API key, no network call.

```ts
import { transliterate } from "tiny-finglish";

const result = transliterate("salam, man emrooz miram Muscat");
```

```json
{
  "text": "سلام، من امروز میرم Muscat",
  "alternatives": ["سلام، من امروز می‌رم Muscat"],
  "confidence": 0.7,
  "spans": [
    { "input": "salam",  "output": "سلام",  "action": "convert", "confidence": 0.64 },
    { "input": "Muscat", "output": "Muscat", "action": "copy",   "copyReason": "english" }
  ]
}
```

**Status: working through the milestones in [`PLAN.md`](PLAN.md) and
[`ROADMAP.md`](ROADMAP.md).** M0, M1, M2 and M4 are done; M3 and M5 are not
started. See [Where this actually is](#where-this-actually-is).

---

## What it is, honestly

A **tiny task-specific neural sequence model** — a character-level grapheme
transducer of roughly 30k–500k parameters. It is "an LLM" only in the loosest
sense, and the README says so deliberately, because two very different things
share the phrase "a small LLM in the browser":

| | size | example |
|---|---:|---|
| a real LLM in the browser | 0.7–2.1 GB (4-bit) | SmolLM2 1.7B, Qwen 1.7B |
| a task-specific tiny net | 27 KiB | `gpu-lexer` |

This belongs at the second end. A general LLM *would* solve Finglish — it has
memorized Persian orthography — at roughly 20,000× the budget, which defeats the
premise. Claiming "LLM" invites comparison against models 20,000× larger.

## Install

```bash
npm install tiny-finglish
```

Works with no setup: without weights the deterministic rule baseline runs.

```ts
import { transliterate, configure, Transliterator } from "tiny-finglish";

// Zero setup — rule baseline.
transliterate("salam");

// With the learned model.
import weights from "tiny-finglish/weights.json" with { type: "json" };
configure({ model: weights });

// Or an explicit instance. `frequency` and `bigram` are separate fetches —
// see `decodeFrequencyTable` and `decodeBigramTable`.
const engine = new Transliterator({ model: weights, lexicon, frequency, bigram });
engine.transliterate("man emrooz miram daneshgah");
```

### Pick your accuracy-per-byte point

Four entry points, measured with `node scripts/size.ts --tiers`:

| entry | contents | gzip | Brotli |
|---|---|---:|---:|
| `tiny-finglish` | tokenizer, rules, dictionary, beam, model runtime, sentence pass | 15.6 KiB | **13.8 KiB** |
| `tiny-finglish/rules` | the same, without the model runtime | 12.8 KiB | **11.3 KiB** |
| `tiny-finglish/normalize` | Persian text normalization alone | 0.9 KiB | **0.8 KiB** |
| `tiny-finglish/metrics` | word accuracy and CER, to score it yourself | 0.5 KiB | **0.4 KiB** |

`./rules` is not a reduced reimplementation — `RuleTransliterator` extends the
same `Pipeline` as `Transliterator` and overrides nothing, and the two produce
byte-identical output on all 2,029 committed inputs. The 2.5 KiB it saves is
the neural runtime, which `"."` imports unconditionally because its constructor
builds a `Transducer`; `"sideEffects": false` cannot help a bundler there.

Data is always a separate fetch, never bundled, so the accuracy you pay for is
the accuracy you choose:

| + data | Brotli | gold word accuracy |
|---|---:|---:|
| nothing | 11.3 KiB | 64.5% |
| **frequency + vowels** | **73.5 KiB** | **74.3%** |
| frequency + vowels + bigrams (opt-in) | 147.1 KiB | 74.7% |
| frequency + vowels and the model (`"."`) | 160.0 KiB | 71.2% |
| ...model and rules ranked jointly (`hybrid: true`) | 160.0 KiB | 72.1% (76.9% orthographic) |

Measured on the 1,669-row audited gold set, September 2026. The previous
figures (62.3% for rules + frequency, 51.2% for the model) were on the
1,835-row set before its audit; see
[the September 2026 round](#september-2026-dictionary-decoding-llm-distillation-llm-measurement).

The vowel table (8.1 KiB) is fetched with the frequency table and only used
with it: it carries the vowels of the 3,615 table words a typed `a` cannot tell
apart, which is how `salam` is سلام and not سالم. See
[the vowel-agreement round](#september-2026-vowel-agreement-and-the-v7-model).

**The model is still behind the rules on real input**, by 3.1 points, down from
11. It earns its bytes on ZWNJ, adversarial input and mixed English, and it
adds orthographic accuracy when ranked jointly with the rules.

**The bigram row is opt-in**, because 73.6 KiB for +0.9 points is 82 KiB per
point against 8.9 for the frequency table — the worst accuracy-per-byte
artifact here. It is built, committed, measured and documented; it is not in
the default download and not in the headline. Turn it on with
`new Transliterator({ bigram })` or `node scripts/run-fixtures.ts --bigram`.

### Options

| option | default | meaning |
|---|---|---|
| `alternatives` | 3 | whole-text alternatives to return |
| `beamWidth` | 8 | decode beam width |
| `candidatesPerSpan` | 3 | candidates kept per span |
| `persianPunctuation` | `true` | `? ; ,` → `؟ ؛ ،` in Persian runs only |
| `protect` | `[]` | extra tokens to pass through untouched |
| `forceConvert` | `[]` | tokens to convert even if detected as English |
| `backend` | `"auto"` | inference backend; CPU today |

## What it does not touch

URLs, emails, `@mentions`, `#hashtags`, numbers, backticked code, identifiers
(`API_KEY`, `userName`), emoji, and text already in a non-Latin script pass
through **byte-identical**. This is asserted at 100% in the test suite and is
the one threshold with no slack, because mangling a URL is the fastest way to
lose a user.

English detection is deliberately conservative and small. A large English
dictionary is actively harmful here: `man` is من, `to` is تو, `in` is این,
`bad` is بد, `sad` is صد, `dust` is دوست, `name` is نامه. See
`src/english.ts`.

## How it works

```
[1] tokenize + protect  →  [2] transduce  →  [3] beam decode
                                    ↓
[5] sentence pass  ←  [4] lexicon snap (optional, off by default)
     └ Viterbi over 30k word bigrams, when `bigram` is supplied
```

The model **generates** and the deterministic layer **constrains** — not the
reverse. Rules-generate-then-rank hits candidate explosion: measured on a
reimplementation of the best existing Finglish tool, enumeration gives a median
of 504 candidates per word and a p99 of ~92,000.

Full detail in [`docs/architecture.md`](docs/architecture.md).

## Measured results

### September 2026: vowel agreement, and the v7 model

`salam` came out سالم ("healthy") instead of سلام ("hello") on every tier. The
channel scores the two identically — each has one ا and one unwritten vowel —
so frequency decided, and in written Persian سالم is the commoner word. What
separates them is the vowel neither spelling writes: سالم is *sālem*, and a
typed `salam` has an `a` where it has an `e`.

`data/lexicon/fa-vowels.bin` carries exactly that: the vowels of the 3,615
frequency-table words that collide with another once ا/آ is removed, from
HomoRich (CC0) through the gold/dev exclusion, 8.1 KiB. `SCORING.vowelAgreement`
charges a candidate for each typed vowel its own vowels contradict, against its
groupmates only (`src/vowels.ts`). It is the same mechanism as the largest error
category, long vowels, and it is what let the retrained model ship. Gold, strict
/ orthographic, scored once at the end:

| tier | before | after | what changed |
|---|---:|---:|---|
| rules + frequency | 73.8 / 76.0 | **74.3 / 76.4** | vowels +0.4, `heBorrow` +0.1 |
| model + frequency | 70.5 / 75.4 | **71.2 / 75.9** | v6 → v7, plus both terms |
| hybrid | 72.1 / 76.8 | **72.1 / 76.9** | v6 → v7, plus both terms |

On dev (the tuning surface), strict / faithful: rules 58.4 / 69.5 → 58.8 /
69.8, model 56.2 / 67.2 → 57.0 / 67.8, hybrid 57.7 / 68.7 → 58.2 / 69.3.
Fixtures: 84.3 → 87.8, 91.5 → 93.7, 92.8 → 93.4.

* **v7 ships.** It was trained last round on 3,000 more LLM-typed sentences aimed
  at the word-final ه, and held back only because it wrote `salam` as سالم. With
  the vowel term it beats v6 on dev strict (57.0 vs 56.4) and the fixtures (93.7
  vs 91.2) under the same scoring, and `salam` is pinned on all three tiers in
  `test/vowels.test.ts`. On hybrid gold, v6 with the same terms would score 72.2
  to v7's 72.1.
* **`in ketaabe` → این کتابه**, the documented ezafe-002 miss, via
  `SCORING.heBorrow`: at a clause end only, an out-of-table ه form borrows its
  bare form's frequency. It is tuned to the one cost at which no tier loses, not
  to a flat region, and it costs `bekhatere` typed alone on the model tier.
* **Two things the plan assumed that measurement changed.** Scoring a vowel-count
  mismatch as "no evidence" made the term worth nothing on dev; charging a typed
  vowel the word does not have (`saham` against سهم) is what makes it pay. And
  moving probability *between* groupmates lifted غلات over غلط, a word the term
  knows nothing about; the shipped term only ever charges.

### September 2026: dictionary decoding, LLM distillation, LLM measurement

**Headline: rules + frequency 73.5% strict word accuracy on real human
Finglish**, up from 62.3%. Of that, 4.6 points is a metric correction and the
rest is the converter. Full account in
[`docs/llm-work.md`](docs/llm-work.md) and
[`docs/error-taxonomy.md`](docs/error-taxonomy.md).

Rules + frequency on gold, strict:

| step | gold | kind |
|---|---:|---|
| as previously published (1,835 rows) | 62.3% | |
| 160 more misaligned rows quarantined by a two-family LLM audit | 66.9% | **metric correction** |
| dictionary candidates + noisy-channel ranking, detached-affix passes, rule-table fixes | 72.6% | 0 bytes |
| channel re-fitted from 3,000 LLM-typed sentences | **73.5%** | +1 KiB |

Every engine, the same 1,669 rows:

| engine | strict | orthographic | judged-acceptable (418-row sample) | dev: strict / faithful / judged |
|---|---:|---:|---:|---:|
| **rules + frequency** | **73.5%** | 75.7% | 85.6% | 58.2 / 69.2 / 79.1 |
| model + frequency | 69.2% | 73.9% | — | 55.6 / 66.3 / — |
| hybrid (`hybrid: true`) | 71.4% | 76.3% | 85.8% | 57.6 / 68.6 / 81.3 |
| rules + frequency + bigrams (opt-in) | 74.1% | — | — |
| *reference: Claude Opus 5, zero-shot* | *77.7%* | *84.0%* | — |
| *reference: GPT-5.6 luna, zero-shot (418 rows)* | *76.7%* | *83.0%* | — |
| elektito/finglish 1.5.1 (Python) | 67.8% | — | — |

The three tiers:

* **Strict** is the headline and unchanged.
* **Orthographic** folds spelling conventions Persian writers disagree on:
  آ/ا, digit scripts, and می/ها-style affixes joined or spaced.
* **Judged-acceptable** refunds only word runs that *both* an LLM judge from
  each family accept as an orthographic variant or a faithful rendering of
  what was typed. The judges agreed with 100 hand-labelled runs at κ 0.90, with
  zero false accepts. It is secondary, it is on a fixed sample, and it is never
  the headline.

What made the difference, in order of size:

1. **Candidate generation, not data.** 87% of the words the old engine got
   wrong were already in its frequency table. A consonant-skeleton index
   proposes them, and a noisy channel ranks them without charging a rare letter
   twice (`src/dictionary.ts`).
2. **Reading the errors.** An LLM classified all 1,545 remaining error runs on
   a new real dev set. That found the typist's detached ezafe (`sal e`) and
   detached plurals (`ketaab haa`). Handling those is +9.2 dev points, and +5.1
   of it is an orthographic convention, labelled as one.
3. **LLM-typed training data.** 3,000 sentences typed by calibrated LLM personas
   took the model from 55.0% to 69.2% on gold, and re-fitted the rule engine's
   channel.

Tuning happened only on [`data/dev/`](data/dev/README.md), and gold was scored
once per phase. The older sections below are kept as they were measured.

### Scaling curve (M2)

Same architecture at four sizes, trained on 479,877 aligned examples from
100,761 Persian stems. Evaluated on held-out **words** — the split is by Persian
word *before* Finglish variants are generated, so no test word appears in
training under any spelling.

| size | params | word acc | int8 | int6 | + lexicon | lexicon gain |
|---|---:|---:|---:|---:|---:|---:|
| 30k | 27,660 | 0.8206 | 0.8204 | 0.8215 | 0.8719 | +0.0513 |
| **100k** | **102,348** | **0.8535** | 0.8533 | **0.8527** | 0.8955 | +0.0420 |
| 500k | 541,516 | 0.8753 | 0.8754 | 0.8743 | 0.9066 | +0.0312 |

Full analysis in [`docs/m2-scaling-curve.md`](docs/m2-scaling-curve.md). The 2M
point was deliberately abandoned: at ~5.6 bits/parameter it would be ~1.4 MB
Brotli, roughly 5.6× the size cap, so it was excluded before it could finish.

Three things fall out:

* **Quantization is free.** int8 and int6 land within 0.1 points of float32 at
  every size, so the choice is decided purely on bytes — and int6 is ~30%
  smaller after Brotli.
* **The lexicon gain shrinks monotonically as the model grows** (+5.1 → +4.2 →
  +3.1 points), which is the trend the capacity argument predicts: the model is
  absorbing more of the vocabulary. The runtime snap tier is built but
  **disabled by default**.
* **Accuracy decelerates** (+3.3 then +2.2 points) while size grows 5× per step,
  and 500k busts the size cap. That is what selects 100k as the shipped model.

### Budgets

The shipped default is the **100k model at int6**, chosen from the curve:

| model | quant | weights | + JS | + frequency | vs 250 KiB cap |
|---|---|---:|---:|---:|---|
| 30k | int8 | 31.6 KiB | 40.7 KiB | 94.9 KiB | ok (38%) |
| **100k** | **int6** | **84.0 KiB** | **97.8 KiB** | **151.9 KiB** | **ok (61%)** |
| 100k | int8 | 106.5 KiB | 115.6 KiB | 169.8 KiB | ok (68%) |
| 500k | int6 | 368.3 KiB | 377.4 KiB | 431.6 KiB | **over** |
| 500k | int8 | 538.6 KiB | 547.7 KiB | 601.9 KiB | **over** |

The frequency column is a separate fetch, never bundled. It is 54.2 KiB for
+6.1 points on real input, where the model itself is worth −11.1 — the best
accuracy-per-byte in the project, and the reason it is the one data artifact
that ships by default.

int6's one-ASCII-character-per-weight encoding is **32% smaller than int8**
after Brotli at 500k, for no measurable accuracy cost — which is what makes the
100k model comfortable rather than marginal.

| | measured | budget |
|---|---:|---:|
| keystroke, incremental word | < 0.01 ms | 16 ms |
| keystroke, end of sentence (warm) | 0.03 ms | 16 ms |
| sentence, cold | ~40 ms | 100 ms |
| shipped bundle, Brotli | **160.0 KiB** | ~250 KiB soft cap |

The bundle is 13.8 KiB of code, 84.0 KiB of weights, 54.1 KiB of frequency and
8.1 KiB of vowels; the last two are separate fetches, never bundled, so a
consumer who wants only the rules pays 11.3 KiB. The 73.6 KiB bigram and the 98.3 KiB lexicon are built and
measured but not counted — see the accuracy-per-byte table below. Both budgets
are enforced in CI.

The keystroke row is the one that answers the obvious worry about a sentence
model: `sentencePass()` re-scores the *whole sentence* on every keystroke and
costs 0.2% of a frame, because the per-word memo it reads from is context-free
and never has to be invalidated. No debouncing, no incremental rescoring.

### On the hand-authored fixtures

The 212 fixtures in `data/fixtures/` are hand-written and include deliberately
adversarial and ambiguous cases. With the shipped 100k model:

| category | n | word acc | sentence | top-3 |
|---|---:|---:|---:|---:|
| protected | 13 | 100.0% | 100.0% | 100.0% |
| sentence | 25 | 97.5% | 92.0% | 96.0% |
| mixed | 8 | 97.3% | 87.5% | 87.5% |
| ambiguous | 36 | 94.4% | 97.2% | 100.0% |
| ordinary | 74 | 93.2% | 93.2% | 97.3% |
| zwnj | 18 | 92.6% | 94.4% | 94.4% |
| adversarial | 10 | 90.0% | 90.0% | 100.0% |
| ezafe | 5 | 81.8% | 60.0% | 80.0% |
| informal | 22 | 79.2% | 77.3% | 95.5% |
| **all** | 211 | **93.7%** | **91.5%** | **96.7%** |

`ezafe` is five minimal pairs for the word-final ه. `in ketaabe`, a documented
miss for two rounds, now passes on the rules and model tiers
(`SCORING.heBorrow`); the model's remaining miss is `dare khune baaze`, where it
writes the detached ezafe as داره. The one adversarial miss is `aaaaaaa`, one ا
short. See `SCORING.finalHe` in `src/baseline.ts`.

**The gap between the synthetic test set and this one is the honest number for
data this project did not generate** — and the gap to the gold set below, data it
did not *write*, is larger still: 93.7% here against 57.0% on the dev set. It is the
synthetic-data bias the plan's risk register predicted, and it is why the
hand-authored set exists.

### Learned model vs the rule baseline

The M1 rule baseline is the floor the model has to beat. On the same fixtures:

| metric | rule baseline | model (100k) |
|---|---:|---:|
| word accuracy | 87.8% | **93.7%** |
| sentence exact | 87.2% | **91.5%** |
| top-3 | 91.9% | **96.7%** |
| CER | 0.045 | **0.021** |
| mixed-English | 86.5% | **97.3%** |
| ambiguous | 83.3% | **94.4%** |
| sentence | 96.2% | **97.5%** |
| ezafe | **100.0%** | 81.8% |
| adversarial | 80.0% | **90.0%** |
| **ZWNJ placement** | **0.0%** (0/11) | **66.7%** (10/15) |

(Both with the frequency table, which is the shipped configuration.)

The ZWNJ row is the single clearest argument for the learned component:
positional rule tables are **structurally incapable** of emitting U+200C, so
every one of the ~23% of Persian word types that contains one is guaranteed
wrong. Treating ZWNJ as an ordinary output label fixes that by construction.

The rule baseline still wins where its candidate list is wider: it takes the
`ezafe` bucket, because the word-final ه tilt (`SCORING.finalHe`) needs the two
readings close together to move between them, and the model's distribution is
more peaked. v7, trained on 3,000 sentences typed to end in a ه word, narrowed
that gap from 72.7% to 81.8%. Worth remembering if you use `alternatives` rather than `text`.

### The untouched gold set — real human Finglish

**1,835 pairs of Finglish that real people typed**, from
[mmahdibarghi/finglish-dataset](https://github.com/mmahdibarghi/finglish-dataset)
(MIT), whose Persian side comes from Mozilla Common Voice Persian (CC0).
Nothing in this repository is tuned against it.

```
node scripts/run-fixtures.ts --gold
```

| evaluation set | n | word acc | sentence |
|---|---:|---:|---:|
| synthetic held-out words | 23,933 | 80.9% | — |
| hand-authored fixtures | 193 | 78.9% | 74.1% |
| **real human Finglish** | **1,835** | **51.2%** | 3.9% |

**51.2% is the number to quote for the shipped model** — and the rule baseline
scores 62.3% on the same set, which is the next section. Everything above the
last row is measured against data this project wrote, and the gap is the cost
of that.

Those two figures were 46.8% and 56.4% before this round of work. Most of the
difference is a scoring correction and about a point is real: see
[what the last five points were](#five-points-of-the-old-number-were-a-scoring-artifact).
A further +0.9 is available from
[sentence context](#sentence-context-measured-and-not-shipped-by-default), which
is opt-in and is not counted here.

The synthetic row is the one exception to "run the command and see": it is
measured in `training/` against held-out corpus words, before the frequency
reranker that the other two rows use.

Report **word accuracy**, not sentence exact-match. At ~8 words per sentence
the latter collapses to ~3% and stops telling you anything — a system that gets
90% of words right still fails most sentences.

### Five points of the old number were a scoring artifact

The headline was 56.4% (rules) and 46.8% (model) until the metric was fixed.
Neither the converter nor the weights changed:

| | rules + frequency |
|---|---:|
| as previously published | 56.45% |
| punctuation folded on both sides | **59.77%** (+3.32) |
| also excluding 71 misaligned rows | **61.26%** (+1.49) |

**Punctuation.** The gold's Persian side glues marks to words — `کردم،`,
`میکند.` — where this converter emits punctuation as its own span. `کردم` was
correct and scored wrong. `src/metrics.ts` now folds marks to a separator
before splitting, on both sides, exactly as it already folded ZWNJ and for the
same stated reason. Punctuation *localization* is still measured, separately,
in `scripts/_report.ts`.

The one thing that would make this a way of inflating every number equally is
if it moved every dataset equally. It does not:

| set | model + freq | rules + freq |
|---|---:|---:|
| fixtures (author-written) | +0.54 | +0.78 |
| authored gold (author-written) | +0.00 | +0.00 |
| **gold (real, third-party)** | **+3.17** | **+3.32** |

The sets this project wrote were written with clean tokenization. The collected
one was not. That asymmetry is the evidence.

**Misaligned rows.** 71 of the 1,906 (3.7%) have two sides that are simply
different sentences — input `4 you have to call` against reference
`چهارم، توزیع مجدد ثروت`. The existing word-count filter cannot see them,
because their word counts happen to agree. They score 0% for every engine at
every beam width. They now live in `data/gold/gold-misaligned.jsonl`, moved
rather than deleted, with the selecting rule and both hashes in
`data/provenance/gold.json`.

Every subject in `data/results/comparison.json` is rescored under the same
change, including elektito/finglish, which the same artifact was flattering.

### The rule baseline beats the learned model on real input

Adding corpus word frequencies — 25,000 words from a CC0 source, 55 KiB — is
the largest single accuracy gain in the project. It also produced its most
uncomfortable result:

Each row is one command — `--rules`, `--no-frequency`, `--bigram`, in any
combination. The lexicon is loaded throughout. The shipped default is in bold;
`+ context` rows are opt-in and cost 73.6 KiB.

| engine | hand-authored fixtures | **real human Finglish** |
|---|---:|---:|
| rule baseline | 61.3% | 56.2% |
| rule baseline + context | 64.2% | 58.8% |
| model | 75.3% | 48.8% |
| model + context | 75.6% | 50.6% |
| **model + frequency** (shipped) | **78.9%** | 51.2% |
| model + frequency + context | 80.3% | 52.6% |
| **rule baseline + frequency** | 74.2% | **62.3%** |
| rule baseline + frequency + context | 75.3% | 63.2% |

On the fixtures *I wrote*, the neural model wins by 4.7 points. On Finglish
*real people typed*, the deterministic baseline wins by 11.1 points.

Per category on the fixtures, the model's wins are real and specific: ZWNJ
(70.4% vs 33.3% — rule tables structurally cannot emit U+200C), adversarial
input (90.0% vs 50.0%), mixed English (90.6% vs 78.1%). But on ordinary running
text from real users, broader candidate generation plus a good frequency prior
beats a transducer trained on a generator.

This is what the prior art predicted and I did not expect to reproduce so
cleanly: on comparable tasks, dictionary-plus-rules-plus-language-model systems
beat fine-tuned neural models at this scale, and architecture choice moves
accuracy by under a point while the language model moves it by twenty.

That last clause needs a caveat this project measured for itself, and it is in
[where the missing points actually are](#where-the-missing-points-actually-are).

**So the learned model does not currently earn its place on real data.** It
earns it on ZWNJ and on adversarial robustness; it loses the average. The
honest reading is that the transducer is overfit to its generator, and that a
hybrid — model for ZWNJ-bearing and mixed spans, rules-plus-frequency
otherwise — is the obvious next experiment.

### A negative result worth more than the positive one

Real data exposed a real bug in the corpus generator. Measured over 21,874 word
tokens of actual typing:

| spelling | generator emitted | people actually write |
|---|---:|---:|
| `x` for خ | 30% | **0.1%** |
| `q` for ق | 30% | **3.9%** |
| `w` for و | 30% | 1.6% |
| `ee` for ی | 30% | 0.9% |
| `aa` for long ɒː | canonical | **23%** (`a` is 69%) |

Those weights are now measured and encoded (`latinWeights` in `src/rules.ts`).
Retraining on the corrected distribution:

| evaluation set | before | after |
|---|---:|---:|
| hand-authored fixtures | 69.6% | **74.8%** |
| author-written gold | 51.4% | **61.0%** |
| **real human Finglish** | 44.9% | **44.6%** |

(Both columns predate the frequency table, so they are lower than the current
figures above. They are left as measured — changing one side of a before/after
would destroy the comparison.)

It bought +5 and +10 points on the sets *I* wrote, and **nothing** on the set
real people wrote.

That is the same trap as before, one level up: the curated sets share the
author's assumptions and the real one does not. The conclusion is that **the
synthetic corpus is not the bottleneck.**

### Where the missing points actually are

For a long time the by-elimination answer above was "the missing sentence
context model", on prior art putting context at ~21 WER points against under
one point for architecture. That citation turns out to be only half right here,
and `scripts/oracle.ts` is how it got checked instead of assumed:

```
node scripts/oracle.ts
```

| engine | top-1 | oracle best-of-8 | recoverable by reranking | never proposed |
|---|---:|---:|---:|---:|
| rules + frequency | 68.8% | 79.1% | **+10.3 pts** | **20.9%** |
| model + frequency | 60.9% | 74.8% | +13.9 pts | 25.2% |

Measured over the 1,057 sentences whose spans align one-to-one with the
reference (7,331 words), at `candidatesPerSpan: 8, beamWidth: 16`.

A language model is a reranker. **+10.3 points is the ceiling on all of it,
with a perfect one** — and the larger bucket, 20.9%, is words the decoder never
proposes at any beam setting, which no reranker can reach. The prior art's
21-point gain sat on top of a pair 6-gram FST, a far richer candidate generator
than this; its number is about a ranking-limited system and this one is
recall-limited. The two are not comparable, and the ordering of the work
follows the measurement, not the citation: candidate generation first, language
model second.

### Sentence context: measured, and not shipped by default

`data/lexicon/fa-bigram.bin` is 30,000 Persian word bigrams — 73.6 KiB Brotli,
a separate fetch — counted from the same CC0 HomoRich corpus as the frequency
table and through the same gold-sentence exclusion, which is not optional:
97.3% of gold sentences appear in HomoRich because both draw on Common Voice.
`sentencePass()` decodes them with a Viterbi over the per-span candidate lists.

| | fixtures | gold |
|---|---:|---:|
| model + frequency | 78.9% | 51.2% |
| + context | 80.3% | 52.6% |
| rules + frequency | 74.2% | 62.3% |
| + context | 75.3% | 63.2% |
| rules, no frequency | 61.3% | 56.2% |
| + context | 64.2% | 58.8% |

**+1.4, +0.9 and +2.6 points, against a +9.6 ceiling — and it is off by
default.** Not because the gain is imaginary but because of what it costs per
point, which is the comparison the size table makes and the accuracy table
hides:

| artifact | Brotli | gold gain, rules | KiB per point |
|---|---:|---:|---:|
| word frequency | 54.2 KiB | +6.1 | **8.9** |
| vowels of confusable words | 8.1 KiB | +0.4 | **20.3** |
| word bigrams | 73.6 KiB | +0.9 | **81.8** |
| model weights | 76.0 KiB | −11.1 | negative |

(The vowel row was measured in a later round, against rules + frequency at
73.8%; the others are as first measured.)

The bigram is the worst accuracy-per-byte artifact in this repository by a
factor of nine, so the default download does not include it and the headline
does not claim it. `node scripts/run-fixtures.ts --bigram` turns it on, the
playground has a toggle for it, and `bigramGain` in
`data/results/comparison.json` publishes what it buys for every configuration.
Note the third row of that first table: it is worth most, +2.6, to the *poorest*
configuration, where there is no frequency table doing the same job.

The flips it makes are good ones — on the gold set it changes 81 words and gets
45 of them right that were wrong, against 11 it breaks — it simply does not fire
often: only 27% of the gold set's adjacent reference pairs are in a 30,000-pair
table. Widening it does not help. 45,000 pairs cost 37 KiB more and moved the
fixtures not at all.

Two implementation notes that are load-bearing rather than incidental:

* **Scores are pointwise mutual information, not conditional probability.** A
  missing pair has to mean *zero*. With `log P(w2|w1)` every stored pair scores
  negative and every pruned pair scores 0, so pruning the table would promote
  what it removed — the same argument `src/frequency.ts` makes for unknown
  words, one order up.
* **The word cache never needs invalidating.** It memoizes candidate
  *generation*, which is context-free and stays context-free; the sentence pass
  only reorders a cached list. A warm fifteen-word sentence including the
  Viterbi measures 0.03 ms against a 16 ms frame, so there is nothing a lattice
  cache could save and a correctness problem it would introduce.

Where the rest went, from `node scripts/oracle.ts --misses`: of the 20.3% of
reference words the decoder never proposes, 48% differ in register (input
`khaane`, reference `خونه`), 31% are rows whose two sides do not correspond word
for word despite matching counts, 13% differ only in a long vowel and 8% carry
an ع that Finglish does not write. **Under 1% differ from our answer only by a
homophone letter class** — the part a better generator or a better reranker
could actually reach. That is why this is where the work stops rather than where
a trigram starts.

## Known limitations

Read this section before trusting any number above.

**The synthetic corpus guesses short vowels.** Persian is an abjad; going
Persian → Finglish needs pronunciation, and no redistributable Persian
pronunciation dictionary exists (the obvious one is GPL). Consonants and the
long-vowel skeleton are faithful — the `dar`/`daar` distinction that carries the
real ambiguity is preserved structurally — but short-vowel *quality* is sampled
from a prior. See the module docstring of `training/tiny_finglish_training/g2p.py`.

**The lexicon has no frequency ranking.** Membership alone cannot rank `سلام`
above `سلم`: both are attested Persian words. This is the single largest
correctable accuracy gap, and closing it needs a corpus
([`docs/open-items.md`](docs/open-items.md)).

**The language model is a bigram, it is opt-in, and it is nearly spent.** Step
[5] promotes an attested alternative over an unattested near-tie, and — when
you supply `bigram` — runs a Viterbi over 30,000 word bigrams, worth +1.4
points to the model and +0.9 to the rules for 73.6 KiB. That is 82 KiB per
point, nine times worse than the frequency table, which is why it is not in the
default download. `scripts/oracle.ts` caps a *perfect* reranker at +9.6, and
`--misses` says four fifths of what is left carries information the Finglish
never contained. A trigram would cost several times the bytes for a slice of a
shrinking remainder. See [sentence
context](#sentence-context-measured-and-not-shipped-by-default).

**The gold set is real, but it is one annotator.** 1,669 pairs of genuinely
human-typed Finglish — a large improvement on the author-written set it
replaced — but written by a single person for a text-to-speech project, so it
is read-aloud register rather than chat, with that writer's habits baked in.
`data/gold/README.md` has the panel protocol that would fix it.

**Part of the gold set is unreachable by any transliterator.** The annotator
often typed a *formal* Finglish rendering of a *colloquial* Persian original:
input `aan ham agar biaayand`, reference `اونم اگه بیان`, and a faithful
`آن هم اگر بیایند` scores 0%. Probing 20 such pairs finds 99 rows (5.4%)
scoring 44.4% against 62.2% on the rest, and twenty probes is a floor. The
information needed to pick the colloquial form is not in the input. Subtract it
from any claim about remaining headroom.

**Realistic ceiling: 85–92% word accuracy.** This model is at 69.2% on real
input and the rule baseline at 73.5% — 74.1% with sentence context enabled — and
a frontier LLM zero-shot at 77.7%, so
there is a lot of headroom, but it is
not all reachable, and most of what is reachable is candidate generation before
it is the language model. Anything claiming above 95% offline in this budget
should be assumed to be leakage until proven otherwise.

**Specific known misses**, each with a fixture: `SALAM` in all-caps is preserved
as an identifier; `email` is preserved as English rather than converted to
ایمیل; `اول` romanizes as `ool` rather than `avval`.

## Privacy

Everything runs in the page. No text leaves the browser, there is no telemetry,
and the package makes no network request — the weights are a local import.

## Demo

```bash
npm install
npm run playground            # http://localhost:5173
```

Three panels, all running in the tab with no server:

* **Try it** — one input, with every span, every candidate the decoder
  considered, its probability and the reason it was chosen. Preset examples
  cover the etymological homophones, ZWNJ, protected spans and vowel length.
  The lexicon-snap tier (§4) is a toggle, so you can see what it would do.
* **Fixture suite** — all 194 committed fixtures, or the 1,835 untouched gold
  cases, run in-browser in ~130 ms. Per-category accuracy, copy-span
  preservation, and **every failure expanded in full** with expected vs. got
  and the candidate distribution that produced it. Toggling the model off runs
  the rule baseline instead, so the two are directly comparable.
* **Scaling curve** — the M2 result the shipped configuration was selected
  from, and the same model measured against all three evaluation sets.

It is built to show what the model gets wrong. The failure list is the point of
the page, not an appendix to it.

## Development

```bash
npm install
npm test                      # 138 JS tests
npm run typecheck
node scripts/run-fixtures.ts  # fixture report with per-candidate reasons
node scripts/run-fixtures.ts --verbose --rules   # rule baseline, every failure
node scripts/run-fixtures.ts --dev --rules       # the tuning surface, all three tiers
node scripts/sweep.ts --grid frequency=4,5,7     # tune scoring constants on dev + fixtures
node scripts/judge.ts --export DIR --dev         # charged word runs for the LLM judges
node scripts/bench.ts         # latency budget
node scripts/size.ts          # Brotli size report
node scripts/parity.ts        # PyTorch vs browser
node scripts/compare.ts --print   # this vs every other implementation
npm run playground
```

`scripts/compare.ts` writes `data/results/comparison.json`, which the
playground's **Compare** tab renders. It benchmarks the three configurations of
this project, a ~30-line naive floor, and the two third-party implementations
that can be installed — `elektito/finglish` through `training/.venv`, and
NeveshtYar, the only other JavaScript implementation, as a pinned git
devDependency. Third parties are playground-only: the published package still
has no dependencies. Without them the tab degrades to our engines plus the
committed figures.

Training:

```bash
cd training
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python torch numpy pytest brotli
.venv/bin/python -m pytest tests -q                       # 243 tests

.venv/bin/python -c "from tiny_finglish_training.corpus import build; \
  from pathlib import Path; build(out_dir=Path('corpora/full'), variants=6)"

.venv/bin/python -m tiny_finglish_training.train  --corpus corpora/full --out runs/dev
.venv/bin/python -m tiny_finglish_training.sweep  --corpus corpora/full --out runs/m2
.venv/bin/python -m tiny_finglish_training.parity --checkpoint runs/dev/best.pt \
    --weights ../data/fixtures/weights.json --out ../data/fixtures/parity.jsonl
```

Rebuilding the lexicon from upstream:

```bash
./scripts/fetch-lexicon.sh
node scripts/build-lexicon.ts
```

### Repository layout

```text
src/            tokenize, normalize, rules, pipeline, runtime, decode, quant, index
                pipeline.ts is the model-free half; rules-engine.ts is the
                `tiny-finglish/rules` entry built on it
training/       Python: corpus generation, PyTorch, eval, quantized export
data/fixtures/  hand-authored fixtures, normalization + parity fixtures, weights
data/gold/      untouched evaluation set, plus the quarantined misaligned rows
data/lexicon/   committed front-coded artifacts (stems, frequency, vowels, bigrams)
                + upstream provenance
scripts/        the harness: run-fixtures, oracle, compare, bench, size, parity
playground/     Vite app showing every candidate and its reason
```

Committed: gold fixtures, exported weights, parity fixtures, hashes, provenance.
Not committed: training corpora, `.pt` checkpoints, the upstream dictionary.

## Where this actually is

| milestone | state |
|---|---|
| M0 — contract, fixtures, normalization | **done** — 194 fixtures, idempotent normalizer verified in two languages |
| M1 — deterministic skeleton + data pipeline | **done** — tokenizer, generator, rule baseline, playground |
| M2 — scaling curve | **done for the decision it exists to make** — 3 sizes published, lexicon-at-runtime settled, shipped model selected; 2M skipped as over budget |
| M3 — train the chosen model properly | **not started** — no seeded runs, no MLM pretraining, no n-gram baseline |
| M4 — quantized export + runtime + parity | **done** — parity holds at 6.7e-6 against a 2e-3 tolerance, both int8 and int6 |
| M5 — open-source release | **not started** — not published to npm; `exports` subpaths and the tier table are in place |
| M7 — accuracy, measured rather than assumed | **done** — metric corrected, oracle measured, segmentation prior, 30k-bigram sentence pass |
| M8 — dictionary decoding, LLM measurement and distillation | **done** — gold audited, dev set built, noisy-channel dictionary, three scoring tiers, model retrained on LLM-typed data; 73.5% rules, 69.2% model on audited gold |

Where the accuracy work stands, and why it stops here. Real human Finglish,
rules + frequency + context:

| | gold word accuracy | shipped? |
|---|---:|---|
| as previously published | 56.4% | |
| punctuation folded on both sides | 59.8% | metric only |
| 71 content-mismatched rows quarantined | 61.3% | metric only |
| segmentation prior + wider beam | **62.3%** | **yes, 0 bytes** |
| 30k word bigrams in the sentence pass | 63.2% | opt-in, 73.6 KiB |

The first two are a measurement correction, the third is free, and the fourth
costs 82 KiB per point — nine times worse than the frequency table — so it is
built and measured but not in the default download.

The shipped 62.3% is within a point of `elektito/finglish` (63.1%) at 3% of its
download and in a browser, which it cannot do at all; with the bigram enabled it
passes it, at 6%.

It does **not** reach the 85–92% band the literature reports, and the remaining
gap is mostly not addressable from here. `node scripts/oracle.ts --misses` says
four fifths of what the decoder never proposes carries information the Finglish
never contained: a colloquial reference against a formal input, an ع nobody
writes, or a row whose two sides are not the same sentence. Closing the rest
needs the panel-collected gold set `data/gold/README.md` specifies, not a bigger
model and not a bigger language model.

## License

MIT. See [`NOTICE`](NOTICE) for third-party attribution — the Persian stem list
is derived from **Lilak** (Apache-2.0), and that file also records which widely
used Persian resources were deliberately *excluded* on licensing grounds, so the
exclusions are a decision rather than an oversight.

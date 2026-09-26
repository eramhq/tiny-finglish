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

// With the learned model. The model and the rules are then ranked jointly
// (the hybrid), the most accurate setup; `hybrid: false` lets the model decide alone.
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
| `tiny-finglish` | tokenizer, rules, dictionary, loanwords, beam, model runtime, sentence pass | 22.2 KiB | **19.3 KiB** |
| `tiny-finglish/rules` | the same, without the model runtime | 19.2 KiB | **16.8 KiB** |
| `tiny-finglish/normalize` | Persian text normalization alone | 0.9 KiB | **0.8 KiB** |
| `tiny-finglish/metrics` | word accuracy and CER, to score it yourself | 0.5 KiB | **0.4 KiB** |

`./rules` is not a reduced reimplementation — `RuleTransliterator` extends the
same `Pipeline` as `Transliterator` and overrides nothing, and the two produce
byte-identical output on all 2,589 committed inputs. The 2.5 KiB it saves is
the neural runtime, which `"."` imports unconditionally because its constructor
builds a `Transducer`; `"sideEffects": false` cannot help a bundler there.

Data is always a separate fetch, never bundled, so the accuracy you pay for is
the accuracy you choose:

| + data | Brotli | gold, orthographic (headline) | gold, strict |
|---|---:|---:|---:|
| nothing | 16.8 KiB | 68.1% | 64.7% |
| frequency + vowels | 80.4 KiB | 78.3% | **74.4%** |
| frequency + vowels + bigrams (opt-in) | 154.0 KiB | 78.9% | 74.9% |
| ...and the model deciding alone (`hybrid: false`) | 167.3 KiB | 78.9% | 72.5% |
| **...and the model, ranked jointly with the rules (`"."` default)** | **167.3 KiB** | **79.4%** | 73.0% |

Measured on the 1,669-row audited gold set, September 2026. The previous
figures (62.3% for rules + frequency, 51.2% for the model) were on the
1,835-row set before its audit; see
[the September 2026 round](#september-2026-dictionary-decoding-llm-distillation-llm-measurement).

**The headline is the orthographic tier**, which forgives only what Persian
writers genuinely disagree on: می‌کنم, میکنم and می کنم are one word, as are
کتاب‌ها and کتابها, آ and ا, and digits in any script. No gold, dev or chat
reference writes the half-space (ZWNJ), so the strict tier marks a correct
می‌کنم wrong. That penalizes the engines that write proper Persian, which are
the model and the hybrid. Strict stays in the table. See
[fair grading](#september-2026-fair-grading).

The frequency table is HomoRich's top 25,000 words plus 566 chat words it
lacked (کجایی, کتابه, حوصلم — see [the chat round](#september-2026-chat)).
The vowel table (8.3 KiB) is fetched with it and only used with it: it carries
the vowels of the 3,667 table words a typed `a` cannot tell apart, which is how `salam` is سلام and not سالم. See
[the vowel-agreement round](#september-2026-vowel-agreement-and-the-v7-model).

**With a model, the hybrid is the default.** It is the most accurate setup on
the headline: +1.1 points over the rules on gold (95% CI +0.8 to +1.4, better on
202 sentences, worse on 69) and +0.5 over the model alone, and it writes the
half-space. On the strict tier the rules lead by 1.4, which is the half-space
convention, not better words.

**The bigram row is opt-in**, because 73.6 KiB for +0.6 points on the
headline is 123 KiB per point, against 6 for the frequency table and 79 for the
model as the hybrid — the worst accuracy-per-byte artifact here, and worth
only +0.3 once the model is loaded. It is built, committed, measured and documented; it is not in
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

A table of 456 loanwords outranks it: `pizza`, `email`, `backup` and a capped
list of 15 chat brands (`instagram`, `google`) convert to پیتزا, ایمیل, بکاپ,
اینستاگرام, گوگل, unless the words next to them are English (`open google
chrome` keeps `google chrome`), they are capitalized mid-sentence, or you pass
them in `protect`. Every other brand stays English. See `src/loan.ts`.

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

### September 2026: fair grading

Three findings, all from `scripts/ab.ts`, which pairs two setups on the same
rows and bootstraps over sentences (`docs/benchmarks.md`).

* **The strict tier penalizes the half-space.** No reference in gold, dev or
  the chat sets writes ZWNJ, so the rules, which never write it, lead on strict
  and trail on everything else. With the half-space forgiven, the hybrid leads
  on every set, and the gap is real on gold and dev:

  | hybrid − rules, orthographic | gold | dev | chat-dev | fixtures |
  |---|---:|---:|---:|---:|
  | points (95% CI) | **+1.1** (+0.8 to +1.4) | **+0.7** (+0.1 to +1.2) | +1.4 (0.0 to +2.6) | +1.1 (−0.6 to +2.9) |

  The headline is now the orthographic tier, with strict beside it.
* **The orthographic tier was wrong until now.** It counted correct words after
  joining (می کنم is one word) but divided by the unjoined count, so a perfect
  می کنم scored 50%. Every orthographic figure before this round, including the
  77.6% the table above used to show for the hybrid, is about two points low.
  The sections below keep the figures they were published with.
* **A retrain moves by about a point on its own.** v8's recipe at two other
  seeds lands within about a point of v8 on dev and chat-dev. A model gain that
  small needs a second seed before it counts.

### September 2026: the object marker, abbreviations and a better loanword guard

Three fixes from the chat-dev errors left after the loanword round, in front of
the model again. Chat numbers are AI-typed.

* **The object marker `-o` on native words** (`Pipeline.objectMarker`). The
  largest error group left: every engine wrote `dishabo` as دیشب, dropping the
  و. When the best candidate does not end in و, the word is read as stem +
  optional possessive + `o`, and if the stem converts to a frequency-table
  word, stem + ending + و goes first: دیشبو, تولدشو, پولمو, نامتو. Not after
  a final ع (`tanavo` تنوع). It misfires on a glued conjunction (`resturano`,
  رستوران و), one of its two dev firings.
* **Texting abbreviations** (`src/loan.ts`, 55 entries): `mrc` مرسی, `slm`
  سلام, `nmdnm` نمیدونم, matched exactly. 150 written by luna (not Claude,
  which typed the chat sets), reviewed by Claude and luna 6: 73 accepted by
  both. English ones both accepted (`idk` → نمیدونم) are not built — that is
  translation, not transliteration.
* **The loanword guard asks for evidence.** It used to drop a loanword
  whenever the engine read its letters as a common word. Now the colliding word
  is cleared when the LLM-typed corpus has it typed at least 10 times and
  never with the loanword's spelling: سری is typed `seri`/`sari` 92 times and
  never `sorry`. 11 loanwords come back (`sorry`, `team`, `pass`, `delete`,
  `please`…); `file` stays out, as فیل is typed only twice. 456 built.

Against `main`, on the same 244 scored fixtures (4 new rows), rules / model / hybrid:

| | before | after |
|---|---|---|
| chat-dev | 89.1 / 90.8 / 90.5 | **90.8 / 91.2 / 92.3** |
| dev strict / faithful | 58.9/70.1 · 58.1/69.0 · 58.3/69.2 | 58.9/70.1 · 58.2/69.0 · 58.3/69.3 |
| fixtures | 88.6 / 92.5 / 92.7 | 89.6 / 93.0 / 93.5 |
| gold (scored once) | 74.3 / 72.4 / 72.9 | **74.4 / 72.5 / 73.0** |
| chat-test (scored once) | 86.2 / 80.1 / 79.0 | **87.1 / 80.1 / 79.9** |

Each alone, chat-dev: object marker +1.3 / +0.1 / +1.5 (dev faithful −0.1 on
rules), abbreviations +0.4 / +0.3 / +0.4, the guard 0 (dev +0.1). The model
tier gains least because it already writes کتابو for `ketabo` and the lexicon
tie-break swaps it back to کتاب; the marker only steps in when no و was
written. +0.7 KiB Brotli.

### September 2026: stretched words and loanwords

The two largest fixable groups left in chat-dev after the chat round, both
fixed in front of the model, so every tier gets them and nothing was retrained.

* **Stretched words** (`src/stretch.ts`). `merciiii` is converted as `merci`
  and the stretch is written back on the last Persian letter, the way Persian
  chat stretches: مرسیییی. A run of two (`aa`) is a spelling, not a stretch;
  a stretch is written back only at the end of a word and only when the letters
  agree (`hmmm` → هممم, `okkk` → اوکی). **The metric folds a stretch** —
  three or more of one Persian letter — to one letter on both sides, so
  مرسیییی scores as مرسی. That is a metric correction, reported alone below.
* **Loanwords typed the English way** (`src/loan.ts`). `backup`, `cake`,
  `pizza`, `email` → بکاپ, کیک, پیتزا, ایمیل, plus Persian endings on a table
  stem (`laptopam` → لپتاپم, `storyasho` → استوریاشو, `laptope` → لپتاپه at a
  clause end and لپتاپ in `laptope man`), and 15 chat brands (`instagram`,
  `google`, `digikala`). The table overrides the English list; a table word
  next to English stays English. 494 entries were written by two Claude
  subagents blind to the evaluation sets, 15 brands added by hand, and each
  reviewed by Claude and by luna: 474 accepted by both. A mechanical guard then
  drops 29 whose letters the engine already reads as an everyday Persian word
  (`love` → لو, `file` → فیل), leaving 445. Provenance and every drop are in
  `data/provenance/loanwords.json`. +4.8 KiB Brotli of JS, 3.4 KiB of it the
  table.

Each measured against `main` on dev, chat-dev (AI-typed, closest accepted
spelling) and the 241 fixtures, which now include 13 rows for these two fixes:

| change | rules chat-dev | model chat-dev | hybrid chat-dev | dev, fixtures |
|---|---:|---:|---:|---|
| metric fold alone | +0.2 | +0.2 | +0.3 | dev 0.0 |
| stretch, on the fold | +0.1 | 0.0 | +0.1 | dev 0.0 |
| loanwords, on the fold without stretch | +3.1 | +3.6 | +3.5 | dev faithful +0.1 / +0.1 / 0.0 |
| **both** | **85.7 → 89.1** | **87.0 → 90.8** | **86.6 → 90.5** | no loss anywhere |

Fixtures with both: rules 86.1 → 89.3, model 89.3 → 93.3, hybrid 89.1 → 93.3,
partly by construction; on the 227 fixtures from before this round 87.6 → 88.2,
92.2 → 92.8, 92.0 → 92.5 (`email et ro befrest`, `ok bashe`).

Scored once, at the end (strict; chat-test is AI-typed):

| tier | gold before → after | chat-test before → after |
|---|---:|---:|
| rules + frequency | 74.3 → **74.3** | 85.6 → **86.2** |
| model + frequency | 72.4 → **72.4** | 79.0 → **80.1** (accepted 87.9 → 89.0) |
| hybrid | 72.8 → **72.9** | 78.2 → **79.0** (accepted 87.1 → 87.9) |

Gold is flat, as expected: read-aloud typing has almost no stretches or
English spellings. Chat-test gains less than chat-dev because it has fewer
English-spelled loanwords (10 table hits in 100 messages), and one of them,
`file`, is a word the guard drops.

### September 2026: chat

Users mostly type Finglish in chat, and nothing measured it: gold and dev are
read-aloud sentences. This round built a chat test set, fixed the engine's chat
gaps without training, typed a chat corpus, and trained v8 on it.

**Every chat number here is AI-typed.** An LLM wrote the Persian and another
typed the Finglish, and LLM typing converts 10–17 points easier than human
typing ([`docs/llm-work.md`](docs/llm-work.md) §5). Read the chat columns as
differences, not as how well it handles chat. The set is described in
[`data/chat/README.md`](data/chat/README.md): 300 messages, written by Claude,
reviewed by Claude and luna (kept only when both accept), typed by Claude with a
`texting` persona unlike the training typists', split into `chat-dev` (200, for
tuning) and `chat-test` (100, scored once).

Engine changes, each measured on its own against dev, the fixtures and chat-dev:

* **A chat supplement to the frequency table**: 566 words from the chat
  training pool that HomoRich's top 25,000 lacks, all at one score (0.4, the
  interior of a region flat over 0.35–0.45 on every tier). +1.2 KiB.
* **The lexicon tie-break counts table words as attested.** It had been
  swapping a right answer the stem lexicon lacks (کتابه) back to its stem.
* **`ci` → سی** (`merci`, `cinema`) and **a final `i`/`ei` → یی** (`kojai`,
  `tanhaei`): table words no channel path could reach before.
* **`heBorrow` is removed.** With کتابه in the table it bought nothing on any
  tier, and off gives `bekhatere` back as بخاطر on the model tier.

**v8 ships**, trained on 1,701 chat sentences (700 HomoRich lines with a chat
word, 1,001 of the reviewed LLM chat lines) typed by five luna agents, which
took the corpus to 14,660 sentences. Of two arms, the one that splits LLM
examples by sentence rather than by word won, so خوبی now trains instead of
landing in the held-out split. It writes `merci` and `kojaei` on the model tier,
which v7 never did.

Scored once, at the end (strict; chat-test also against the closest accepted
spelling). The model rows are v7 → v8, engine changes included:

| tier | gold before → after | chat-test before → after (AI-typed) |
|---|---:|---:|
| rules + frequency | 74.3 → **74.3** | 83.7 → **85.6** |
| model + frequency | 71.2 → **72.4** | 75.4 → **79.0** (accepted 87.9) |
| hybrid | 72.1 → **72.8** | 75.0 → **78.2** (accepted 87.1) |

Dev strict / faithful: rules 58.8 / 69.8 → 58.8 / 70.0, model 57.0 / 67.8 →
58.0 / 68.9, hybrid 58.2 / 69.3 → 58.2 / 69.2. Fixtures (now 227, with 16
`chat` rows): rules 85.9 → 87.6, model 90.2 → 92.2, hybrid 90.5 → 92.0.

**It ships with one known miss, by decision.** The round's ship rule required
`ketabe` → کتابه on every tier, and v8's model tier writes کتاب: it prefers the
ezafe reading (`ketabe man`) 81/19 even after the clause-final tilt. Closing
that with `finalHe` takes 3.5, where the model tier starts losing fixtures. A
follow-up round typed 489 chat lines ending in the copula (v8b); it moved
`ketabe` to 60/40, started writing `daneshjooha` as دانشجوهه, and lost 0.3 on
dev, so it was not shipped either. The rules and hybrid tiers write کتابه, and
`test/chat.test.ts` pins the model tier's miss. v8 also loses ground on the ZWNJ
fixtures (92.6 → 77.8) and the ambiguous ones (94.4 → 88.9) while gaining on
`chat`, `informal` and `ordinary`.

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
| rules + frequency | 73.8 / 76.0 | **74.3 / 76.4** | vowels +0.4, `heBorrow` +0.1 (removed since) |
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
  (The chat round removed it: the supplement put کتابه in the table.)
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
| shipped bundle, Brotli | **167.3 KiB** | ~250 KiB soft cap |

The bundle is 19.3 KiB of code, 84.4 KiB of weights, 55.3 KiB of frequency and
8.3 KiB of vowels; the last two are separate fetches, never bundled, so a
consumer who wants only the rules pays 16.8 KiB. About 3.8 KiB of the code is the
loanword and abbreviation tables, which is bundled because the rules-only tier needs it too. The 73.6 KiB bigram and the 98.3 KiB lexicon are built and
measured but not counted — see the accuracy-per-byte table below. Both budgets
are enforced in CI.

The keystroke row is the one that answers the obvious worry about a sentence
model: `sentencePass()` re-scores the *whole sentence* on every keystroke and
costs 0.2% of a frame, because the per-word memo it reads from is context-free
and never has to be invalidated. No debouncing, no incremental rescoring.

### On the hand-authored fixtures

The 228 fixtures in `data/fixtures/` are hand-written and include deliberately
adversarial and ambiguous cases. With the shipped 100k model:

| category | n | word acc | sentence | top-3 |
|---|---:|---:|---:|---:|
| protected | 13 | 100.0% | 100.0% | 100.0% |
| sentence | 25 | 98.7% | 96.0% | 100.0% |
| mixed | 8 | 97.3% | 87.5% | 87.5% |
| ordinary | 74 | 94.6% | 94.6% | 98.6% |
| adversarial | 10 | 90.0% | 90.0% | 100.0% |
| ambiguous | 36 | 88.9% | 94.4% | 100.0% |
| informal | 22 | 87.5% | 86.4% | 100.0% |
| chat | 16 | 82.8% | 68.8% | 93.8% |
| ezafe | 5 | 81.8% | 60.0% | 80.0% |
| zwnj | 18 | 77.8% | 83.3% | 88.9% |
| **all** | 227 | **92.2%** | **90.3%** | **97.4%** |

`chat` is new this round: the chat failures the round targeted, in different
words from the chat test set. v7 got 4 of 16; v8 gets 11, the rules tier 11 and
the hybrid 10 (`test/chat.test.ts`). `ezafe` is five minimal pairs for the
word-final ه. `in ketaabe` passes on the rules and hybrid tiers; the model tier
writes کتاب (see the chat round above), and its other miss is `dare khune
baaze`, where it writes the detached ezafe as داره. The ZWNJ bucket fell with
v8, from 92.6 to 77.8. The one adversarial miss is `aaaaaaa`, one ا
short. See `SCORING.finalHe` in `src/baseline.ts`.

**The gap between the synthetic test set and this one is the honest number for
data this project did not generate** — and the gap to the gold set below, data it
did not *write*, is larger still: 92.2% here against 58.0% on the dev set. It is the
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
`data/gold/README.md` has the panel protocol that would fix it. The chat sets
cover chat, but they are AI-typed, so they measure differences, not how well
real chat typing converts.

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
as an identifier; `اول` romanizes as `ool` rather than `avval`.

**Loanwords and stretches have edges.** The loanword table only knows 456
English spellings, and its guard drops a loanword whose letters also spell an
everyday Persian word unless typists are seen never to spell that word so, so
`file` and `battery` are still read as Finglish (فیل, بطری). English
chat abbreviations (`idk`, `btw`) stay English: only Persian skeletons
(`mrc`, `nmdnm`) are in the abbreviation table. A brand outside the capped list stays English. A
stretch in the middle of a word (`salaaaam`) is collapsed and not written back,
and a stretch is only written back when the letters agree (`okkk` is plain
اوکی).

## Privacy

Everything runs in the page. No text leaves the browser, there is no telemetry,
and the package makes no network request — the weights are a local import.

## Demo

```bash
npm install
npm run playground            # http://localhost:5173
```

Three panels, all running in the tab with no server:

* **Convert**: type Finglish on the left, Persian appears on the right as you
  type. Words the engine was unsure of are underlined; select one to see the
  other spellings and how likely each is, and swap one in. Switch between
  rules only, model only and both (the default), and see the conversion time
  and the download each setup costs.
* **How accurate is it?**: the three setups scored in the tab on the gold set
  (typed by people), chat-dev (AI-typed) or the fixtures, with the same
  scoring as `scripts/run-fixtures.ts`, so the numbers match this README. A
  checkbox switches to the strict tier. Below, the mistakes one setup made, a
  few at a time, with the wrong words marked.
* **What's inside**: download sizes, the conversion steps and speed.

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

# Historical README at 96b9ff3

Archived for research and contributor continuity. This is the README from source
revision `96b9ff39d9accff72b8d634925833a5d6f337c97`, before the bilingual guide
refresh. Its installation command, example JSON, model descriptions, and metrics
mix several historical states; do not treat them as current setup instructions.
Use the [current guides](en/overview.md) and [verification record](evaluation-2026-10-09.md).
Relative links below have been adjusted for this archive location.

# tiny-finglish

Convert **Finglish** — Persian typed in Latin/ASCII — into Persian script,
entirely in the browser. No server, no API key, no network call.

**[Try the demo](https://eramhq.github.io/tiny-finglish/)** — type Finglish,
see Persian, and score the engine on real typed sentences, all in your tab.

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

**Status: working through the milestones in [`PLAN.md`](../PLAN.md) and
[`ROADMAP.md`](../ROADMAP.md).** M0, M1, M2, M4, M7 and M8 are done; M5, the
release, is in progress; M3 is not started. See [Where this actually is](#where-this-actually-is).

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

Works with no setup, but that is the weakest configuration: the rules alone,
59.5% of gold words right. The package also ships the model and the two word
tables the accurate setup needs (84.2%), as separate files you load yourself —
they are 84 KiB and 69 KiB Brotli, so no bundler pulls them in by accident.

```ts
import { transliterate } from "tiny-finglish";

transliterate("salam").text; // rules only, no data
```

**Node** (20.10 or later):

```ts
import { readFileSync } from "node:fs";
import { configure, decodeFrequencyTable, decodeVowelTable, transliterate, type WeightArtifact } from "tiny-finglish";
import weights from "tiny-finglish/weights.json" with { type: "json" };

const read = (name: string) => readFileSync(new URL(import.meta.resolve(`tiny-finglish/${name}`)));
configure({
  model: weights as WeightArtifact,
  frequency: decodeFrequencyTable(read("frequency.bin")),
  vowels: decodeVowelTable(read("vowels.bin")),
});
transliterate("masalan ba lotfan").text; // مثلا با لطفا
```

**Browser**, with a bundler (Vite shown; `?url` asks it for the file's URL):

```ts
import { Transliterator, decodeFrequencyTable, decodeVowelTable, type WeightArtifact } from "tiny-finglish";
import weights from "tiny-finglish/weights.json";
import frequencyUrl from "tiny-finglish/frequency.bin?url";
import vowelsUrl from "tiny-finglish/vowels.bin?url";

async function createEngine(): Promise<Transliterator> {
  const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const [frequency, vowels] = await Promise.all([bytes(frequencyUrl), bytes(vowelsUrl)]);
  return new Transliterator({
    model: weights as WeightArtifact,
    frequency: decodeFrequencyTable(frequency),
    vowels: decodeVowelTable(vowels),
  });
}
```

The `.bin` files ship uncompressed (125 KiB and 42 KiB), because a browser
cannot undo Brotli from script; serve them with compression on and the wire
cost is the Brotli figure. With a model, the model and the rules are ranked
together (the hybrid), the most accurate setup; `hybrid: false` lets the model
decide alone.

### Pick your accuracy-per-byte point

Four entry points, measured with `node scripts/size.ts --tiers`:

| entry | contents | gzip | Brotli |
|---|---|---:|---:|
| `tiny-finglish` | tokenizer, rules, dictionary, loanwords, beam, model runtime, sentence pass | 24.6 KiB | **21.4 KiB** |
| `tiny-finglish/rules` | the same, without the model runtime | 21.5 KiB | **18.8 KiB** |
| `tiny-finglish/normalize` | Persian text normalization alone | 0.9 KiB | **0.8 KiB** |
| `tiny-finglish/metrics` | word accuracy and CER, to score it yourself | 0.5 KiB | **0.4 KiB** |

`./rules` is not a reduced reimplementation — `RuleTransliterator` extends the
same `Pipeline` as `Transliterator` and overrides nothing, and the two produce
byte-identical output on all 2,589 committed inputs. The 2.6 KiB it saves is
the neural runtime, which `"."` imports unconditionally because its constructor
builds a `Transducer`; `"sideEffects": false` cannot help a bundler there.

Data is always a separate fetch, never bundled, so the accuracy you pay for is
the accuracy you choose:

| + data | Brotli | gold, orthographic (headline) | gold, strict |
|---|---:|---:|---:|
| nothing | 18.8 KiB | 59.5% | 54.9% |
| frequency + vowels | 87.4 KiB | 83.1% | **76.3%** |
| frequency + vowels + bigrams (opt-in) | 161.0 KiB | 83.4% | 76.6% |
| ...and the model deciding alone (`hybrid: false`) | 174.4 KiB | 82.7% | 73.3% |
| **...and the model, ranked jointly with the rules (`"."` default)** | **174.4 KiB** | **84.2%** | 74.6% |

Measured on the 1,669-row audited gold set, September 2026, as shipped:
without the optional 98.3 KiB lexicon (`node scripts/run-fixtures.ts --gold
--no-lexicon`). The round sections below are tuning figures and load it; that
moves the rows with frequency by 0.2 points at most, but the no-data row by
10.7 (70.2% with it). The previous
figures (62.3% for rules + frequency, 51.2% for the model) were on the
1,835-row set before its audit; see
[the September 2026 round](results.md#september-2026-dictionary-decoding-llm-distillation-llm-measurement).
Against a reference edited to what was actually typed, frequency + vowels,
the model alone and the hybrid score 90.7%, 90.3% and 91.9%; the difference is
register, not transliteration
([gold scored against what was typed](results.md#september-2026-gold-scored-against-what-was-typed)).

**The headline is the orthographic tier**, which forgives only what Persian
writers genuinely disagree on: می‌کنم, میکنم and می کنم are one word, as are
کتاب‌ها and کتابها, زمانیکه and زمانی که (compound spacing), بدست and به دست,
چقدر and چه قدر, آ and ا, and digits in any script. No gold, dev or chat
reference writes the half-space (ZWNJ), so the strict tier marks a correct
می‌کنم wrong. That penalizes the engines that write proper Persian, which are
the model and the hybrid. Strict stays in the table. See
[fair grading](results.md#september-2026-fair-grading).

The frequency table is HomoRich's top 25,000 words plus 566 chat words it
lacked (کجایی, کتابه, حوصلم — see [the chat round](results.md#september-2026-chat)).
The vowel table (13.3 KiB) is fetched with it and only used with it: it carries
the vowels of the 6,024 table words a typed vowel cannot tell apart, which is
how `salam` is سلام and not سالم, and `shohar` شوهر and not شهر. See
[the vowel-agreement round](results.md#september-2026-vowel-agreement-and-the-v7-model).

**With a model, the hybrid is the default.** It is the most accurate setup on
the headline: +1.1 points over the rules on gold (95% CI +0.8 to +1.3, better on
166 sentences, worse on 45) and +1.5 over the model alone, and it writes the
half-space. On the strict tier the rules lead by 1.7, which is the half-space
convention, not better words.

**The bigram row is opt-in**, because 73.6 KiB for +0.3 points on the
headline is 245 KiB per point, against 3 for the frequency table and 79 for the
model as the hybrid — the worst accuracy-per-byte artifact here, and worth
only +0.1 once the model is loaded. It is built, committed, measured and documented; it is not in
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

Full detail in [`docs/architecture.md`](architecture.md).

## Measured results

Every round of accuracy work, with confidence intervals, before-and-after
rows and byte costs, is in [`docs/results.md`](results.md), newest first.
The current figures are the table in
[Pick your accuracy-per-byte point](#pick-your-accuracy-per-byte-point).

## Speed and size

| | measured | budget |
|---|---:|---:|
| keystroke, incremental word | < 0.01 ms | 16 ms |
| keystroke, end of sentence (warm) | 0.03 ms | 16 ms |
| sentence, cold | ~40 ms | 100 ms |
| shipped bundle, Brotli | **174.4 KiB** | ~250 KiB soft cap |

The bundle is 21.4 KiB of code, 84.4 KiB of weights, 55.3 KiB of frequency and
13.3 KiB of vowels; the last two are separate fetches, never bundled, so a
consumer who wants only the rules pays 18.8 KiB. About 3.8 KiB of the code is the
loanword and abbreviation tables, which is bundled because the rules-only tier needs it too. The 73.6 KiB bigram and the 98.3 KiB lexicon are built and
measured but not counted — see [measured results](results.md#sentence-context-measured-and-not-shipped-by-default). Both budgets
are enforced in CI.

The keystroke row is the one that answers the obvious worry about a sentence
model: `sentencePass()` re-scores the *whole sentence* on every keystroke and
costs 0.2% of a frame, because the per-word memo it reads from is context-free
and never has to be invalidated. No debouncing, no incremental rescoring.

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
([`docs/open-items.md`](open-items.md)).

**The language model is a bigram, it is opt-in, and it is nearly spent.** Step
[5] promotes an attested alternative over an unattested near-tie, and — when
you supply `bigram` — runs a Viterbi over 30,000 word bigrams, worth +1.4
points to the model and +0.9 to the rules for 73.6 KiB. That is 82 KiB per
point, nine times worse than the frequency table, which is why it is not in the
default download. `scripts/oracle.ts` caps a *perfect* reranker at +9.6, and
`--misses` says four fifths of what is left carries information the Finglish
never contained. A trigram would cost several times the bytes for a slice of a
shrinking remainder. See [sentence
context](results.md#sentence-context-measured-and-not-shipped-by-default).

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

`npm run playground:build` writes a static site to `playground/dist/`. Its
links and data are relative, so it can be hosted from any folder, a GitHub
Pages project site included. Serve the `.bin` files with compression on.

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
| M4 — quantized export + runtime + parity | **done** — parity holds at 1.8e-5 against a 2e-3 tolerance, both int8 and int6 |
| M5 — open-source release | **in progress** — the package ships the model and both word tables and installs cleanly; not yet published to npm |
| M7 — accuracy, measured rather than assumed | **done** — metric corrected, oracle measured, segmentation prior, 30k-bigram sentence pass |
| M8 — dictionary decoding, LLM measurement and distillation | **done** — gold audited, dev set built, noisy-channel dictionary, three scoring tiers, model retrained on LLM-typed data |

Where accuracy stands. On the audited gold set of real human Finglish, the
shipped default gets 84.2% of words right on the headline tier, and 91.9%
against a reference edited to what was actually typed — inside the 85–92% band
[`docs/open-items.md`](open-items.md) §3 sets as the realistic ceiling.
Most of what is left is not transliteration. The reference often writes a
different register than the typing (میتونست for a typed `mitavanest`), and
some words have two real spellings that only context can choose between
(`hamele`: حمله or حامله). The error breakdown is in
[`docs/open-items.md`](open-items.md) §0f and §0g, and every round is in
[`docs/results.md`](results.md).

## License

MIT. See [`NOTICE`](../NOTICE) for third-party attribution — the word-frequency
and vowel tables come from **HomoRich G2P Persian** (CC0), the evaluation sets
from **finglish-dataset** (MIT), and the optional stem list from **Lilak**
(Apache-2.0). That file also records which widely
used Persian resources were deliberately *excluded* on licensing grounds, so the
exclusions are a decision rather than an oversight.

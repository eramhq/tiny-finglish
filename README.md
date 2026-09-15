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

// Or an explicit instance.
const engine = new Transliterator({ model: weights, lexicon });
engine.transliterate("man emrooz miram daneshgah");
```

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
```

The model **generates** and the deterministic layer **constrains** — not the
reverse. Rules-generate-then-rank hits candidate explosion: measured on a
reimplementation of the best existing Finglish tool, enumeration gives a median
of 504 candidates per word and a p99 of ~92,000.

Full detail in [`docs/architecture.md`](docs/architecture.md).

## Measured results

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

| model | quant | weights | + JS | vs 250 KiB cap |
|---|---|---:|---:|---|
| 30k | int8 | 31.6 KiB | 39.6 KiB | ok (16%) |
| **100k** | **int6** | **75.8 KiB** | **83.8 KiB** | **ok (34%)** |
| 100k | int8 | 106.5 KiB | 114.5 KiB | ok (46%) |
| 500k | int6 | 368.3 KiB | 376.3 KiB | **over** |
| 500k | int8 | 538.6 KiB | 546.6 KiB | **over** |

int6's one-ASCII-character-per-weight encoding is **32% smaller than int8**
after Brotli at 500k, for no measurable accuracy cost — which is what makes the
100k model comfortable rather than marginal.

| | measured | budget |
|---|---:|---:|
| keystroke, incremental word | < 0.01 ms | 16 ms |
| sentence, cold | ~22 ms | 100 ms |
| shipped bundle, Brotli | **83.8 KiB** | ~250 KiB soft cap |

8.0 KiB of that is code; the rest is weights. Both budgets are enforced in CI.

### On the hand-authored fixtures

The 175 fixtures in `data/fixtures/` are hand-written and include deliberately
adversarial and ambiguous cases. With the shipped 100k model:

| category | n | top-1 | top-3 |
|---|---:|---:|---:|
| protected | 13 | 100.0% | 100.0% |
| adversarial | 10 | 90.0% | 90.0% |
| ordinary | 67 | 71.6% | 88.1% |
| ambiguous | 31 | 64.5% | 71.0% |
| informal | 21 | 52.4% | 81.0% |
| zwnj | 18 | 50.0% | 66.7% |
| sentence | 7 | 28.6% | 42.9% |
| **all** | 174 | **66.1%** | **79.9%** |

**The gap between 85% on the synthetic test set and 66% here is the headline
honest number.** It is the synthetic-data bias the plan's risk register
predicted, and it is why the hand-authored set exists.

### Learned model vs the rule baseline

The M1 rule baseline is the floor the model has to beat. On the same fixtures:

| metric | rule baseline | model (100k) |
|---|---:|---:|
| top-1 | 56.3% | **66.1%** |
| top-3 | **81.6%** | 79.9% |
| CER | 0.155 | **0.104** |
| mixed-English | 0.0% | **42.9%** |
| ambiguous | 51.6% | **64.5%** |
| **ZWNJ placement** | **0.0%** (0/11) | **28.6%** (6/21) |

The ZWNJ row is the single clearest argument for the learned component:
positional rule tables are **structurally incapable** of emitting U+200C, so
every one of the ~23% of Persian word types that contains one is guaranteed
wrong. Treating ZWNJ as an ordinary output label fixes that by construction.

The rule baseline wins on top-3 because it generates more diverse candidates;
the model's distribution is more peaked. Worth remembering if you use
`alternatives` rather than `text`.

### The untouched gold set

`node scripts/run-fixtures.ts --gold`, 100k model: **47.9% top-1, 62.0% top-3,
CER 0.140.**

Lower than the fixture number, and it should be: the gold set is *all*
conversion, with none of the protected spans that score 100% by construction.
Nothing in this repository is tuned against it — see `data/gold/README.md`.

So the three numbers to hold in mind:

| set | what it measures | 27k | 100k |
|---|---|---:|---:|
| synthetic held-out words | how well the model inverts the generator | 82.1% | **85.4%** |
| hand-authored fixtures | mixed, incl. protected spans and adversarial cases | 60.3% | **66.1%** |
| **untouched gold** | **closest to the real task** | **49.3%** | **47.9%** |

**Read that last row carefully.** Scaling the model from 27k to 100k buys
+3.3 points on the synthetic set and +5.8 on the fixtures, and **nothing on the
untouched gold set** — 49.3% to 47.9% is one example out of 71, i.e. flat within
noise.

That is the synthetic-data bias landing exactly where the plan's risk register
said it would. The model is getting better at inverting the generator, not
necessarily at the task. Until the gold set is rebuilt from native speakers
typing naturally, treat improvements on the first two rows as unproven.

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

**No language model.** Step [5] currently promotes an attested alternative over
an unattested near-tie. The measured literature is unambiguous that this is
where the remaining accuracy lives — on the closest comparable task, adding
context moved word error from 33.8% to 12.2%, while swapping the model
architecture moved it under one point.

**The gold set is author-written, not collected from native speakers typing
naturally.** An author who knows the rule table writes Finglish the rule table
handles. See `data/gold/README.md` for the protocol that would fix it.

**Realistic ceiling: 85–92% word accuracy**, roughly 40–60% sentence accuracy.
Anything above 95% offline in this budget should be assumed to be leakage until
proven otherwise.

**Specific known misses**, each with a fixture: `SALAM` in all-caps is preserved
as an identifier; `email` is preserved as English rather than converted to
ایمیل; `اول` romanizes as `ool` rather than `avval`.

## Privacy

Everything runs in the page. No text leaves the browser, there is no telemetry,
and the package makes no network request — the weights are a local import.

## Development

```bash
npm install
npm test                      # 59 JS tests
npm run typecheck
node scripts/run-fixtures.ts  # fixture report with per-candidate reasons
node scripts/run-fixtures.ts --verbose --rules   # rule baseline, every failure
node scripts/bench.ts         # latency budget
node scripts/size.ts          # Brotli size report
node scripts/parity.ts        # PyTorch vs browser
npm run playground
```

Training:

```bash
cd training
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python torch numpy pytest brotli
.venv/bin/python -m pytest tests -q                       # 226 tests

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
src/            tokenize, normalize, rules, runtime, decode, quant, index
training/       Python: corpus generation, PyTorch, eval, quantized export
data/fixtures/  hand-authored fixtures, normalization + parity fixtures, weights
data/gold/      untouched evaluation set
data/lexicon/   committed front-coded artifact + upstream provenance
playground/     Vite app showing every candidate and its reason
```

Committed: gold fixtures, exported weights, parity fixtures, hashes, provenance.
Not committed: training corpora, `.pt` checkpoints, the upstream dictionary.

## Where this actually is

| milestone | state |
|---|---|
| M0 — contract, fixtures, normalization | **done** — 175 fixtures, idempotent normalizer verified in two languages |
| M1 — deterministic skeleton + data pipeline | **done** — tokenizer, generator, rule baseline, playground |
| M2 — scaling curve | **done for the decision it exists to make** — 3 sizes published, lexicon-at-runtime settled, shipped model selected; 2M skipped as over budget |
| M3 — train the chosen model properly | **not started** — no seeded runs, no MLM pretraining, no n-gram baseline |
| M4 — quantized export + runtime + parity | **done** — parity holds at 6.7e-6 against a 2e-3 tolerance, both int8 and int6 |
| M5 — open-source release | **not started** — not published to npm |

## License

MIT. See [`NOTICE`](NOTICE) for third-party attribution — the Persian stem list
is derived from **Lilak** (Apache-2.0), and that file also records which widely
used Persian resources were deliberately *excluded* on licensing grounds, so the
exclusions are a decision rather than an oversight.

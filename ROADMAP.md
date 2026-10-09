# tiny-finglish — revised roadmap

This revises [`PLAN.md`](PLAN.md) on two points and keeps the rest of its
scaffolding — goals, non-goals, risk register, evaluation metrics — intact.

**Implementation status is tracked in [Milestones](#milestones) below and
summarised in the [historical README](docs/readme-history.md#where-this-actually-is).**

## Recommendation in five points

1. **Invert the architecture.** Model generates, rules constrain — not
   `PLAN.md`'s rules-generate-then-model-ranks. A monotonic character transducer
   never enumerates candidates, so the explosion problem disappears; beam search
   yields alternatives and confidence for free.
2. **Target ~100k–500k parameters**, not `PLAN.md`'s 30k–100k.
3. **Budget latency, not size.** <16 ms per keystroke, <100 ms per sentence,
   enforced in CI. Weight file lands wherever accuracy needs it, soft-capped
   ~250 KiB Brotli.
4. **Build the scaling curve (M2) before committing.** Four sizes, find where
   accuracy flattens, and let that decide whether a lexicon ever ships at runtime.
5. **Follow `gpu-lexer`'s shape, `gpu-time`'s backend policy** — affine-scan
   tagger with 6-bit weights, but CPU-first with auto-escalation rather than
   WebGPU-only.

## The question that decided it

> Is a neural network a more compact encoding of Persian orthography than a
> compressed lexicon?

Persian homophone choice is *etymological, not phonological*: `sabr` → صبر but
`sabz` → سبز, same `s` sound, no derivable rule. It must be memorized per word —
exactly what a lexicon stores. So the architecture turns on whether a
browser-sized model has the capacity to absorb it.

### Sizing argument

**Measured capacity: ~3.6 bits per parameter** (Morris et al. 2025,
[_How much do language models memorize?_](https://arxiv.org/abs/2505.24832)).

The arbitrary content is heavily skewed — the Persian-origin letter dominates,
and only Arabic-loan vocabulary carries ص/ض/ط/ظ/ث/ذ/ح/ع at all — so entropy is
far below `log2(options)`:

```
50,000 words × ~1 bit         ≈  50 kbit    information-theoretic floor
50,000 bits ÷ 3.6 bits/param  ≈  14k params (theoretical minimum)
× 5–10× real-task overhead    ≈  70k–140k params
```

**Conclusion: ~100k–500k parameters**, ~60–250 KiB Brotli at 6-bit packing.

> `PLAN.md`'s 30k–100k target is likely **too small by ~3–5×**; treat both it
> and the 100 KiB budget as hypotheses to test in M2, not fixed constraints.

### How that held up

Measured (see [`docs/open-items.md`](docs/open-items.md)): the homophone
consonants turned out to be a far smaller share of the ambiguity than assumed —
2.47% of types, with a most-frequent tie-break resolving 99.7% of tokens. The
real ambiguity is **vowels**. This *supports* the capacity conclusion, for a
different reason than the one given above.

Actual result: **27,660 parameters reach 82.1%**, 102,348 reach 85.4% and
541,516 reach 87.5% on held-out words. The shipped configuration is the 100k
model at int6, **83.8 KiB Brotli including the runtime** — inside the predicted
~100k–500k parameter band, at its lower end, and at a third of the size cap.

The 500k model busts the 250 KiB cap at both quantization levels (376 KiB at
int6, 547 KiB at int8), so the cap — not accuracy — is what selects 100k.

## Budget latency, not size

**Download.** 250 KiB Brotli ≈ one medium JPEG. jQuery is ~30 KiB gzipped, a
typical React bundle 100–300 KiB, the average 2026 web page ~2.5 MB.

**Inference.** The typing-time path never re-runs the whole sentence: convert
**word-by-word and cache unchanged words**, so each keystroke costs one word.

### Enforced in CI

- **< 16 ms** per keystroke on the incremental word path
- **< 100 ms** per sentence, cold
- weight file soft-capped at ~250 KiB Brotli

The dominant risk to adoption is not bundle weight, it is a model too small to
spell common words correctly. A 100 KiB model that gets `sabr` wrong will be
abandoned faster than a 250 KiB one that gets it right.

## Scale context — "a simple LLM in the browser"

| | Size | Example |
|---|---:|---|
| Real LLM in browser | **0.7–2.1 GB** (4-bit) | SmolLM2 1.7B, Qwen 1.7B |
| Task-specific tiny net | **27 KiB** | `gpu-lexer` |

`tiny-finglish` belongs at the `gpu-lexer` end. Keep that honest in the README;
claiming "LLM" invites comparison against models 20,000× larger.

## Reference projects

Both cited projects are **sequence taggers**, not generative decoders. That is
the right shape here: transliteration is **monotonic**, so a per-position
classifier is smaller and markedly easier to train than a decoder, while beam
search over its per-position distributions still yields alternatives and
confidence.

### `gpu-lexer` (vercel-labs) — closest analogue

| Property | Value |
|---|---|
| Task | Language-agnostic syntax highlighting, 9 output classes |
| Parameters | **41,321** reachable browser weights |
| Quantization | **6 bits** per weight |
| Shipped size | **27.46 KiB** minified + Brotli, runtime included |
| Architecture | 32 embedding channels → neighbourhood + bidirectional **affine scans** → shared-weight binary tree |
| Accuracy | 88.02% agreement, 79.09% styled macro-F1 vs Shiki |

The **bidirectional affine scan** is a linear recurrence — parallelizable,
unlike a GRU/LSTM. This is `PLAN.md`'s experiment #4, already validated in
production.

### `gpu-time` (arikchakma)

Token classifier, 35 roles; backend `auto`: **CPU by default, WebGPU only at
≥32 inputs or ≥512 tokens per batch**. Direct evidence for `PLAN.md`'s instinct
that dispatch overhead dominates for one short sentence.
**Recommendation: CPU-first with `gpu-time`'s `auto` escape hatch.**

### Scaling gap to stay honest about

`gpu-lexer` solves a **9-class, rule-correlated** problem at 41k params. Finglish
needs ~**150 grapheme classes** and much of its decision content is **lexically
arbitrary**. Its 27 KiB is a floor for what this architecture costs, not a
prediction of what this task needs.

## Closest published analogues

- **Roman-Urdu → Urdu** — closest task that exists.
  [Low-Resource Transliteration for Roman-Urdu and Urdu](https://arxiv.org/html/2503.21530v1)
  finds MLM pretraining specifically absorbs *romanized-side spelling inconsistency*.
- **Tajik → Persian** — the *target side is exactly our target side*.
- **Unsupervised decipherment** — [Phonetic and Visual Priors for Decipherment of
  Informal Romanization](https://arxiv.org/pdf/2005.02517), relevant if labelled
  Finglish stays scarce.
- **Existing tool:** [`elektito/finglish`](https://github.com/elektito/finglish) — MIT,
  returns possibilities with confidence in [0,1]. Its API shape validates
  `PLAN.md`'s contract.

## Proposed architecture

```text
Finglish input
      |
      v
[1] Tokenizer + protected-span detector        deterministic, no model
      v
[2] Neural grapheme transducer                 the learned core
      |    embedding -> bidirectional affine scan -> per-position softmax
      v
[3] Beam decode                                top-k candidates + confidence
      v
[4] Lexicon snap / rescore                     OPTIONAL TIER - see M2 decision
      v
[5] Sentence-level context pass
      v
Best output + alternatives + confidence + source spans
```

Length mismatch (`emrooz` 6 chars → امروز 5 chars) is handled by the empty label
and multi-character output symbols — standard practice in monotonic
transduction, and why the tagging formulation works despite unequal lengths.

## Milestones

### M0 — Contract, fixtures, normalization — **done**

- Public `transliterate()` result type — `src/types.ts`
- **175 hand-reviewed fixtures** across 8 categories — `data/fixtures/`
- **Persian normalizer written first** — `src/normalize.ts`, mirrored in Python,
  idempotence asserted over the Arabic blocks, agreement between the two
  implementations pinned by a shared fixture
- License MIT; provenance in `NOTICE` and `data/provenance/`

### M1 — Deterministic skeleton + data pipeline — **done**

- Tokenizer and protected-span detection — `src/tokenize.ts`
- **Synthetic Finglish generator** — `training/.../g2p.py`, the training-data
  engine and the most important artifact of this milestone
- Rule-only baseline — `src/baseline.ts`, a beam rather than a Cartesian product
- Browser playground showing every candidate and its reason — `playground/`

### M2 — Scaling curve — **done** (3 sizes; 2M skipped as over budget)

| size | params | word acc | + lexicon | lexicon gain |
|---|---:|---:|---:|---:|
| 30k | 27,660 | 0.8206 | 0.8719 | +0.0513 |
| **100k** | **102,348** | **0.8535** | 0.8955 | +0.0420 |
| 500k | 541,516 | 0.8753 | 0.9066 | +0.0312 |

Full analysis: [`docs/m2-scaling-curve.md`](docs/m2-scaling-curve.md).

**The lexicon gain shrinks monotonically as the model grows**, which is the
trend the capacity argument predicts. The runtime snap tier is built but
**disabled by default**, per the plan's recommended default going in.

Compute note, measured: **CPU beats MPS** at these sizes (23 vs 28 ms/step) —
the affine scan issues one kernel per timestep, and launch overhead dominates.

### M3 — Train the chosen model properly — **not started**

Several seeded runs at the size M2 selects; MLM-style pretraining on the
romanized side; comparison against the M1 rule baseline and an n-gram baseline
on the untouched gold set; a failure bank that does not silently migrate into
the test set.

### M4 — Quantized export + browser runtime + parity — **done**

- Quantized export, int8 and int6, one ASCII char per weight at 6-bit
- Hand-written JS inference matching the PyTorch forward pass; no ONNX Runtime
- **Parity fixtures**: worst logit delta **6.7e-6** against a 2e-3 tolerance
- CPU-first; `backend: "auto"` reserved for a future WebGPU escalation

### M5 — Open-source release — **not started**

npm publish, integration examples, honest documentation of limitations.
`exports` subpaths are in place: `.`, `./rules`, `./normalize`, `./metrics`,
with the measured tier table in the README.

### M6 — Optional expansion

Unchanged from `PLAN.md`.

### M7 — Accuracy, measured rather than assumed — **done**

Not in `PLAN.md`, because it only became formulable once there was a real gold
set to measure against. Four things, in the order the evidence demanded rather
than the order the plan predicted:

1. **Fixed the metric before anything else.** `wordAccuracy` now folds
   punctuation to a separator the way it already folded ZWNJ — the gold's
   Persian side glues marks to words and we emit them as their own spans — and
   71 rows whose two sides are different sentences moved to
   `data/gold/gold-misaligned.jsonl`. Worth 4.9 points of *apparent* accuracy
   and zero of real accuracy, which is why it came first.
2. **Measured where the missing accuracy is**, with `scripts/oracle.ts`,
   instead of inheriting the prior art's answer. It is candidate *generation*,
   not ranking: a perfect reranker is worth +9.6 points, not the +21 the Urdu
   result suggested, because that result sat on a pair 6-gram FST and this sits
   on a beam. **This inverted the roadmap's stated priority.**
3. **Attacked generation first.** A per-unit segmentation prior in
   `RuleBaseline.walk()` — the score had no term for how many units a
   segmentation used, so `g`+`h` beat `gh` by 0.24 nats on every word — plus a
   wider beam. +1.0 on gold, zero bytes. Expanding the Lilak affixes was tried
   and **rejected on measurement**: 1.5M surface forms, +132 KiB, +0.1 points,
   and a cold-start time three times over the gate.
4. **Then the language model, which did not earn its bytes.** 30,000 word
   bigrams, 73.6 KiB, decoded by Viterbi in `sentencePass()`. +1.4 for the
   model, +0.9 for the rules, +2.6 for the rules without frequency. Real, and
   82 KiB per point against 8.9 for the frequency table — the worst
   accuracy-per-byte artifact in the repository. It is built, committed, tested
   and documented, and it is **opt-in**: `--bigram`, or `{ bigram }` on the
   constructor. The shipped download does not pay for it and the headline does
   not claim it.

Result on real human Finglish: **56.4% → 62.3% shipped**, 63.2% with context
enabled. Of the shipped gain, 4.9 points is the measurement correction and 1.0
is the converter, at zero bytes. That is within a point of
`elektito/finglish` at 3% of its download size, and it is not close to the
85–92% band. `scripts/oracle.ts --misses` says why, and the answer is not a
bigger model or a bigger language model: four fifths of what the decoder never
proposes carries information the Finglish input does not contain.

## Verification

- **Normalization:** idempotence property test across all codepoint variants
- **Protected spans:** byte-identity asserted at 100%, no slack
- **Accuracy:** top-1, top-3, CER, ZWNJ, copy-span preservation, reported with
  model artifact hash and dataset hash
- **Parity:** committed fixtures, PyTorch vs browser, wired into CI
- **Latency (primary budget):** CI fails above 16 ms / 100 ms
- **Size (secondary):** reported every build, ~250 KiB soft cap, deliberate
  decision required to exceed rather than automatic failure

## Open items

All four resolved — see [`docs/open-items.md`](docs/open-items.md). Headlines:
Lilak (Apache-2.0) is the redistributable lexicon; Dakshina has no Persian; the
realistic ceiling is 85–92% word accuracy; informal-register data remains the
binding constraint and the two best resources need a licensing email.

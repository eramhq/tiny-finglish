# Architecture

```text
Finglish input
      |
      v
[1] Tokenizer + protected-span detector        deterministic, no model
      |    URLs, emails, @mentions, #hashtags, numbers, code, likely-English
      |    pass through untouched; loanword-table words (pizza, laptopam)
      |    convert unless their neighbours are English
      v
    stretch collapsed (merciiii -> merci), loanword table first; per-word memo
      |
[2] Neural grapheme transducer                 the learned core
      |    per input character -> one label from the Persian grapheme set
      |    (includes the empty label for deletion, and multi-char outputs)
      |    embedding -> neighbourhood -> bidirectional affine scan -> softmax
      v
[3] Beam decode                                top-k Persian candidates + confidence
      |
      v
[4] Lexicon snap / rescore                     OPTIONAL TIER, disabled by default
      |
      v
[5] Sentence-level context pass                resolve remaining word ambiguity
      |    lexicon tie-break, plus a Viterbi over 30k word bigrams when the
      |    `bigram` artifact is supplied — opt-in, see below
      v
Best output + alternatives + confidence + source spans
```

Steps [1] and [5], the rule baseline and the per-word memo live in
`src/pipeline.ts`, which knows nothing about the model. So do the two things
done to a word before any engine sees it: a stretch is collapsed and written
back afterwards (`src/stretch.ts`), and a loanword-table hit is put first at
probability 0.9 (`src/loan.ts`, which also holds an exact-match table of
texting skeletons such as `mrc`). After the engine, `Pipeline.objectMarker`
reads a colloquial `-o` the engine dropped (`dishabo` دیشبو). All of it sits in
front of or around every tier, never inside the model. `src/index.ts` extends
it and fills in one method; `src/rules-engine.ts` extends it and fills in
nothing, which is the `tiny-finglish/rules` entry point. The split is what makes
that entry 6.7 KiB Brotli against 9.1 for the full one — `index.ts` builds a
`Transducer` in its constructor, so the neural runtime is an unconditional
import there and cannot be tree-shaken away.

## What step [5] is worth, measured

A language model at [5] is a **reranker**: it reorders candidates [3] produced
and can never introduce one it did not. `scripts/oracle.ts` measures the ceiling
that puts on it — 79.7% oracle recall against 70.1% top-1, so **+9.6 points for
a perfect reranker**, with 20.3% of reference words never proposed at any beam
width.

That number is why the work went into generation before context, against the
prior art's advice. The closest published analogue puts context at ~21 WER
points, but it measured a system whose generator was a pair 6-gram FST; its
recall is far higher than a beam over a grapheme table, so its ranking headroom
is far larger. **A ranking-limited system's number does not transfer to a
recall-limited one**, and checking which kind you have is a cheap measurement
that changes the order of the work.

The 30,000-pair bigram realizes +1.4 of the +9.6 for the model and +0.9 for the
rules — and is **not shipped by default**, because 73.6 KiB for +0.9 is 82 KiB
per point against 8.9 for the frequency table. It is opt-in: `--bigram`, or
`{ bigram }` on the constructor. `scripts/oracle.ts --misses` accounts for the rest: 48% of
never-proposed words are a register mismatch between a formal input and a
colloquial reference, 31% are rows whose two sides do not correspond word for
word, 13% differ only in a long vowel, 8% carry an ع Finglish does not write,
and under 1% differ only by a homophone letter class.

## Why the model generates and the rules constrain

The inverted design — rules generate candidates, a tiny model ranks them — hits
candidate explosion. Measured on a reimplementation of the best existing
Finglish tool, enumerating per-unit candidates gives a **median of 504
candidates per word, a p99 of ~92,000 and a maximum of ~367,000**. No ranker
rescues a set that noisy, and the enumeration alone is a browser hazard.

A character transducer never enumerates. It emits Persian directly, and beam
search over its per-position distributions supplies alternatives and confidence
from a single forward pass.

Where rules survive, they survive as *constraints*: the tokenizer decides what
must not be touched, and the rule table remains the source of truth for the
synthetic corpus.

## Why a tagger, not a decoder

Transliteration is **monotonic** — no reordering between source and target — so
a per-position classifier is smaller and markedly easier to train than an
encoder-decoder, with no exposure bias and no separate alignment step.

Unequal lengths (`emrooz`, 6 characters → امروز, 5) are handled by two devices
standard in monotonic transduction:

* the **empty label**, when a Latin character contributes nothing;
* **multi-character labels**, when one Latin character stands for several
  Persian ones.

`khahar` → خواهر shows both at once:

```
k:خ  h:∅  a:وا  a:∅  h:ه  e:∅  r:ر
```

The `a` carries `وا` because the `و` of خواهر is silent, and three positions
emit nothing. The label stream concatenates back to the exact source word — a
property asserted over a lexicon sample in `training/tests/test_g2p.py`.

## The affine scan

Each layer runs a linear recurrence in both directions:

```
h[t] = a[t] * h[t-1] + (1 - a[t]) * v[t],   a = sigmoid(Wa x + ba)
```

Two properties earn it its place:

* **Parallelizable in principle**, unlike a GRU or LSTM — it is a linear
  recurrence, and this is the shape already validated in production by
  `gpu-lexer`.
* **Bounded.** Writing the recurrence convexly rather than as `a*h + b` makes
  `|h| ≤ max|v|` unconditionally. That is what keeps post-training quantization
  faithful and what keeps the JavaScript scan from drifting away from PyTorch
  over long inputs — the measured worst-case logit disagreement is 6.7e-6.

It is also about thirty lines to reimplement exactly in JavaScript, which
matters more than it sounds: the parity fixture is only meaningful if the
browser implementation is small enough to be obviously correct.

## Numerical parity

`src/runtime.ts` is a line-for-line reimplementation of
`training/tiny_finglish_training/model.py`. Choices made *for* parity:

| choice | instead of | why |
|---|---|---|
| float32 throughout | TF32 / autocast | one definition of the arithmetic |
| RMSNorm | LayerNorm | no mean subtraction, no epsilon-placement ambiguity |
| ReLU | GELU | exactly representable; no erf/tanh approximation to disagree about |
| convex recurrence | `a*h + b` | bounded state, quantization-friendly |

`scripts/parity.ts` feeds fixed inputs through both and asserts agreement within
2e-3 per logit — roughly a thousand times looser than observed float noise and a
thousand times tighter than the gap between competing labels. It is pinned to
the **quantized** model, because that is the only one the browser ever sees.

## Quantization and the weight format

Per-output-row symmetric quantization. Rows are the natural unit: each output
neuron has its own dynamic range, and one tensor-wide scale would let a single
large row crush the resolution of every other.

Two payload encodings, both measured:

* **int8** — 256 levels, base64 of the raw bytes.
* **int6** — 63 levels, **one ASCII character per weight**.

The second looks wrong and is not. Measured on a comparable shipped model,
one-char-per-weight is 41,321 raw / 20,940 Brotli; base64 of bit-packed 6-bit
codes is 55,096 raw / 27,903 Brotli. The ASCII form is 33% *larger* before
compression and 25% *smaller* after, because bit-packing smears each value
across byte boundaries and destroys the per-symbol regularity Brotli's context
modelling exploits. Compressed size is what ships.

Measured cost of quantizing at all, on held-out words: **essentially zero**
(82.06% float → 82.04% int8 → 82.15% int6 at 27k parameters).

## What is deliberately absent

* **ONNX Runtime** — larger than this entire package by an order of magnitude.
* **WASM** — V8 does not do on-stack replacement for WebAssembly, so a one-shot
  inference completes in baseline (Liftoff) code and never tiers up, while the
  equivalent JS loop does OSR mid-loop. The real comparison is optimized JS
  against *unoptimized* WASM.
* **WebGPU** — dispatch overhead dominates a single short sentence. The
  `backend: "auto"` option exists so a batch-threshold escalation can be added
  later without a breaking change.

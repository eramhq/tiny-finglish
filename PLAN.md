# Tiny Finglish: High-Level Project Plan

## Status

Concept and learning project. No implementation decisions are final until the deterministic baseline and real evaluation set exist.

## One-sentence idea

Build a tiny, private, browser-first Finglish-to-Persian converter that uses deterministic rules to generate possible spellings and a very small learned language scorer to choose the most natural result.

## Why this project

Finglish spelling is inconsistent and ambiguous. A direct letter replacement cannot reliably decide whether `kh`, `gh`, vowels, word boundaries, or mixed English terms should be converted. A full browser LLM is far too large for this task.

The project explores the same principle as `gpu-time` and `gpu-lexer`:

> Use normal code for exact, easy work and a tiny learned model only for contextual ambiguity.

It should also be a useful open-source utility for text editors, search boxes, chat applications, and devices without a Persian keyboard.

## Example

```ts
const result = transliterate("salam, man emrooz miram Muscat");
```

```json
{
  "text": "سلام، من امروز میرم Muscat",
  "alternatives": [
    "سلام، من امروز می‌روم مسقط"
  ],
  "confidence": 0.91,
  "spans": [
    { "input": "salam", "output": "سلام", "action": "convert" },
    { "input": "Muscat", "output": "Muscat", "action": "copy" }
  ]
}
```

## Primary goals

- Run completely in the browser without a server or API key.
- Preserve genuine English names, brands, numbers, URLs, and code.
- Use context to rank ambiguous Persian spellings.
- Return alternatives and confidence instead of pretending every answer is certain.
- Keep the total production download small, with a target of 100 KiB Brotli or less.
- Provide a modern TypeScript API and an interactive educational playground.
- Make Python and browser inference reproducible and numerically comparable.

## Non-goals

- A chatbot or general-purpose LLM.
- Translation between Persian and English.
- Perfect formalization of informal Persian.
- Silent rewriting of long documents.
- Arabic dialect support in the first release.
- WebGPU in the first release unless benchmarks show a real benefit.

## Core design

```text
Finglish input
      |
      v
Tokenizer and protected-span detector
      |
      +-- keep URLs, emails, numbers, and likely English terms unchanged
      |
      v
Deterministic candidate generator
      |
      +-- salam -> سلام / سالم / سلم
      |
      v
Tiny learned Persian language scorer
      |
      v
Beam search / candidate ranking
      |
      v
Best output + alternatives + confidence + source spans
```

The model does not need to generate Persian from nothing. It only scores candidates produced by compact rules. This sharply reduces model size and failure surface.

## Size and runtime budget

Initial targets, to be validated by measurement:

| Component | Compressed target |
|---|---:|
| Candidate generator and tokenizer | 10–25 KiB |
| Learned weights | 20–60 KiB |
| Inference and ranking runtime | 5–15 KiB |
| Total package | 40–100 KiB |

Likely model range:

- 30,000–100,000 learned parameters.
- Start with int8 export; evaluate int6 and int4 only after a correct baseline exists.
- CPU-first scalar or SIMD-friendly JavaScript/WASM inference.
- Optional Web Worker for editor integration.
- Consider WebGPU only for large batches; dispatch overhead may make it slower for one sentence.

Avoid ONNX Runtime in the final size-constrained package because its runtime can be much larger than this model. ONNX may still be useful during experimentation or as a correctness reference.

## Model experiments

Evaluate in increasing complexity rather than selecting an architecture prematurely:

1. **Rule-only baseline:** candidate generation plus fixed frequency scores.
2. **Character n-gram baseline:** compact statistical Persian language model.
3. **Tiny neural scorer:** hashed character features with a small contextual layer.
4. **Tiny recurrent or affine-scan scorer:** only if it materially improves real test cases.
5. **Quantized browser projection:** remove unreachable weights and pack the remaining tensors.

The smallest model that wins on the untouched evaluation set should be preferred.

## Data plan

### Sources

- Legally redistributable Persian text with clear provenance and licensing.
- Synthetic Finglish generated from Persian sentences using multiple plausible spellings.
- Human-written Finglish paired with corrected Persian, collected later with consent.
- Negative and mixed-language examples containing brands, locations, URLs, code, and numbers.

### Important variations

- `kh`, `sh`, `ch`, `zh`, `gh`, `q`, and alternative vowel spellings.
- Informal and formal variants such as `miram` and `miravam`.
- Joined/separated words and Persian ZWNJ behavior.
- Persian, Arabic-Indic, and Latin digits.
- Real English tokens that should remain unchanged.
- Capitalization, punctuation, emoji, hashtags, usernames, and product codes.

### Splits

- Split by source/document before generating variants to avoid train/test leakage.
- Maintain a synthetic development set for fast iteration.
- Maintain a small, untouched human-written gold set for honest evaluation.
- Track a failure bank of real examples without silently moving them into the test set after training.

## Evaluation

Measure more than whole-sentence accuracy:

- Top-1 word accuracy.
- Top-3 candidate recall.
- Character error rate.
- Exact sentence match.
- English/copy-span preservation rate.
- ZWNJ accuracy.
- Confidence calibration and abstention quality.
- Package size after minification and Brotli.
- Cold initialization and warm latency.
- Peak browser memory.
- Python-versus-browser inference parity.

Every reported score should identify the model artifact and dataset hash.

## Milestones

### M0 — Contract and real examples

- Define the public `transliterate()` result type.
- Collect 100–300 representative Finglish/Persian pairs.
- Record mixed-English and deliberately difficult examples.
- Choose the license and document dataset provenance requirements.

**Exit condition:** a human can review the expected output and alternatives for every fixture.

### M1 — Deterministic vertical slice

- Implement tokenization and protected spans.
- Implement a small candidate generator.
- Rank candidates with fixed rules or corpus frequency.
- Publish a minimal browser playground.

**Exit condition:** one command converts the fixture corpus and produces inspectable explanations.

### M2 — Statistical baseline

- Build a character n-gram scorer.
- Compare it with the rule-only result.
- Establish accuracy, size, and latency baselines.

**Exit condition:** the scorer measurably improves ambiguous examples without damaging protected spans.

### M3 — PyTorch model

- Implement the smallest reasonable contextual scorer.
- Train several seeded runs.
- Compare against the n-gram baseline on the untouched gold set.
- Reject the neural model if its improvement does not justify its size.

**Exit condition:** a saved checkpoint has reproducible metrics and clear provenance.

### M4 — Browser runtime

- Export compact weights.
- Implement matching TypeScript/JavaScript inference.
- Add quantization and parity fixtures.
- Move editor inference to a Web Worker if profiling justifies it.

**Exit condition:** Python and browser predictions match within the documented tolerance.

### M5 — Open-source release

- Publish the core npm package.
- Release the playground with candidate/probability inspection.
- Add integration examples for a plain input and one editor.
- Document limitations, privacy, size, speed, and evaluation honestly.

**Exit condition:** a developer can install the package, run it offline, and reproduce the published tests.

### M6 — Optional expansion

- Collect opt-in corrections to improve the gold/failure sets.
- Add a Persian formal/informal output preference.
- Investigate separate Arabic/Arabizi dialect packs.
- Investigate WebGPU only for batch conversion.

## Suggested repository layout

```text
tiny-finglish/
├── apps/
│   └── playground/
├── packages/
│   ├── core/
│   ├── model-runtime/
│   └── training/
├── data/
│   ├── fixtures/
│   ├── gold/
│   └── provenance/
├── benchmarks/
├── docs/
│   ├── architecture.md
│   └── model-card.md
├── PLAN.md
└── README.md
```

Training corpora and checkpoints should not be committed unless their licenses and sizes make that appropriate. Small gold fixtures, exported weights, parity fixtures, hashes, and provenance reports should be versioned.

## Main risks

- **Synthetic-data bias:** generated Finglish may not resemble how people actually type.
- **Ambiguity:** several Persian outputs may be valid; evaluation must allow alternatives.
- **English preservation:** converting brands and names incorrectly will quickly frustrate users.
- **Dataset licensing:** a convenient corpus may not be redistributable.
- **Size creep:** dictionaries, generic runtimes, and tokenizers can exceed the model size.
- **False confidence:** the API must expose alternatives or abstain when uncertain.
- **Premature GPU work:** custom shaders may consume time without improving short-input latency.

## First work session

1. Write the TypeScript input/output contract.
2. Create 50 hand-reviewed fixtures covering ordinary, ambiguous, and mixed-English input.
3. Implement protected-span detection for URLs, emails, numbers, and explicit code.
4. Implement candidates for 10–20 common Finglish letter patterns.
5. Display every candidate and its reason in a tiny local playground.

Do not train a model in the first session. The fixtures and deterministic baseline define what the model must improve.

## Definition of project success

The project succeeds if it produces a genuinely useful offline Finglish converter with an inspectable learned component, stays within a small browser-download budget, and teaches the complete path from data and PyTorch training to quantized browser inference. It does not need chatbot-level intelligence.

## References and inspiration

- [`gpu-time`](https://github.com/arikchakma/gpu-time) — small learned tagger plus deterministic compiler and calendar resolver.
- [`gpu-lexer`](https://github.com/vercel-labs/gpu-lexer) — compact learned classifier with quantized browser weights.
- [`elektito/finglish`](https://github.com/elektito/finglish) — earlier Finglish-to-Persian converter and candidate-ranking reference.
- [Unified Arabizi detection and transliteration](https://aclanthology.org/2020.wanlp-1.15/) — contextual sequence modeling precedent.
- [PyTorch basics](https://docs.pytorch.org/tutorials/beginner/basics/intro.html) — training workflow reference.


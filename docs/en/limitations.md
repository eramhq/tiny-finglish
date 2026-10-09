---
title: "Limitations, troubleshooting, and evaluation"
description: "Diagnose setup differences and interpret benchmark evidence responsibly."
---

# Limitations, troubleshooting, and evaluation

## Know what the input cannot determine

Finglish omits distinctions needed for unambiguous Persian spelling. Names, missing vowels, several consonant spellings, colloquial endings, and English homographs can remain ambiguous. More candidates do not guarantee the intended word is present. The engine does not translate, infer a writer's desired register, or rewrite formal input into colloquial Persian.

A small task-specific model and deterministic passes are not a general language model with full semantic understanding. The model processes words, with shared sentence heuristics and optional bigram context. Half-space placement and suffix joining can be wrong. English and proper-name detection are imperfect. Keep original input and allow review.

## Troubleshoot by checking the configuration first

| Symptom | Check |
|---|---|
| `salam` becomes `سلم` | Bare rules do this at the documented revision. Load both tables and, for the website setup, the model |
| Output differs from the website | Compare source revision, model, both tables, `hybrid`, protection controls, punctuation, and optional lexicon/bigram; do not compare a bare call to hybrid |
| A word stays Latin | Inspect `copyReason`; capitalization, code patterns, or English detection may explain it. Try `forceConvert` only for the intended word |
| A brand turns Persian | Add it to `protect`; recognized loanwords intentionally convert |
| English punctuation changes | Set `persianPunctuation: false`; punctuation conversion is not restricted to Persian runs |
| A table fails to decode | Use packaged decompressed `.bin` bytes, wrap `ArrayBuffer` in `Uint8Array`, and use the matching decoder |
| Assets fail to load | Check response status, deployment base path, CSP/CORS, MIME type, cache version, and network errors |
| Changing the beam has no apparent effect | It controls the model-only path; use a fresh engine when comparing decode settings because the cache omits these settings |
| A score is high but the word is wrong | Confidence is a ranking signal, not accuracy; inspect candidates and keep manual editing available |
| Old text reappears after typing | Version input and discard stale worker responses; see [the worker guide](workers.md) |

The input limit, output review, error messages, retry policy, and privacy of the host application are not supplied by the library.

## Evaluate a named configuration

Current verification is recorded in [evaluation notes](../evaluation-2026-10-09.md), with the source revision, artifact/dataset hashes, exact commands, configuration, and metric. Historical [results](../results.md), [benchmarks](../benchmarks.md), and the [model card](../model-card.md) remain research records; their older measurements do not all describe the same engine.

Run existing reports from a built checkout on Node 24. These commands read committed assets and evaluate; they do not retrain:

```sh
node --experimental-strip-types scripts/run-fixtures.ts --gold --rules --no-frequency --no-vowels --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --rules --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --hybrid --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --no-lexicon
node --experimental-strip-types scripts/size.ts --tiers
```

The fourth command is model-only with frequency and vowels: this script requires `--hybrid` explicitly, unlike the library constructor. The script normally loads a lexicon unless `--no-lexicon` is given. Omitting that flag changes what is being measured. Use development sets for tuning and gold only for reporting.

## Understand the metrics and datasets

Strict word accuracy and the orthographic metric are different. Strict scoring already normalizes text and splits words; it is not raw byte equality. The orthographic tier forgives selected spelling/spacing variations such as half-space conventions. Character error rate measures edit distance at the character level. The `faithful` reference is an additional, reviewed LLM edit toward what was actually typed, not a new sample of independent human typing. Never label a figure simply “accuracy” without its dataset, configuration, reference, and metric.

The [gold data](../../data/gold/README.md) comes from one human annotator and read-aloud text, with audited exclusions and register mismatches. The [chat sets](../../data/chat/README.md) are AI-written and AI-typed; their scores are not measured human chat accuracy. The [dev set](../../data/dev/README.md) is the tuning surface. None represents every visitor's spelling habits.

A compressed bundle measurement depends on bundler settings and compression method. It is not memory use or guaranteed network transfer size. A warm benchmark can reuse cached words and says little about first-load latency. Compare initialization and cold/warm conversion on your target browsers and devices, with asset downloads measured separately. No new latency claim is made by these guides.

## Before a public release

Recheck package publication and supported Node versions; resolve the mismatch between the declared minimum and source-build tooling. Keep the verified examples in sync with the released engine and assets, and preserve LICENSE/NOTICE. Review older source comments about punctuation and probability normalization before treating them as API guarantees. The release's source commit must contain `docs/navigation.json` and both language directories for the website importer; the npm archive's file list currently does not include these guides.

Eram imports public documentation only from published GitHub releases. Uncommitted local previews are review material, not public snapshots. Nothing in this documentation workflow publishes a package, changes a version, or refreshes the website's release lock.

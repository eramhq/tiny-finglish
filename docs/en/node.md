---
title: "Use Tiny Finglish in Node.js"
description: "Load packaged assets, create the hybrid engine, and choose an entry point."
---

# Use Tiny Finglish in Node.js

## Runtime and module requirements

The compiled package is ESM targeting ES2022, with no runtime dependencies. Its manifest declares Node `>=20.10`. The examples and repository checks here ran on Node 24.8.0; this documentation does not certify every version allowed by the manifest. Use `.mjs` or a project with `"type": "module"`. There is no CommonJS `require` export.

Building from source is a separate requirement: `npm run build` uses `node --experimental-strip-types` for `scripts/package-data.ts`. Node 20 cannot run that build command. Use Node 24 for the documented source-install workflow. Loading a built package does not require TypeScript stripping, a DOM, a GPU, Python, or model training.

## Load the website's hybrid configuration

First [install a source archive](installation.md). Save this reusable loader as `hybrid.mjs`. It reads the three package assets through their exported paths, avoiding assumptions about `node_modules` layout and avoiding version-sensitive JSON import syntax.

```js
// Save as hybrid.mjs after installing the source archive.
import { readFileSync } from "node:fs";
import {
  Transliterator, decodeFrequencyTable, decodeVowelTable,
} from "tiny-finglish";

const read = (name) => readFileSync(
  new URL(import.meta.resolve(`tiny-finglish/${name}`)),
);
export const model = JSON.parse(read("weights.json").toString("utf8"));
export const frequency = decodeFrequencyTable(read("frequency.bin"));
export const vowels = decodeVowelTable(read("vowels.bin"));
export const engine = new Transliterator({ model, frequency, vowels });
```

Save the following as `example.mjs` beside the loader and run `node example.mjs`:

```js
import { engine } from "./hybrid.mjs";
console.log(engine.transliterate("salam, emrooz miram shiraz").text);
```

```text
سلام، امروز میرم شیراز
```

This is the same engine configuration used by Eram: `hybrid` defaults to `true` when a model is supplied, with no bigram or lexicon. Data is read from disk, not downloaded at conversion time. Construct the engine once and reuse it. Create separate instances when applications or requests need different configurations; `configure()` replaces the module's shared default engine and is not request-local.

## Public entry points

| Import | Exports and purpose |
|---|---|
| `tiny-finglish` | `Transliterator`, `transliterate`, `configure`, `RuleTransliterator`, tokenizer, normalizer, table decoders, front-coding helpers, public result and model types |
| `tiny-finglish/rules` | `RuleTransliterator`, `RuleBaseline`, `matchKeySet`, shared types and table helpers; no neural runtime and no module-level `transliterate` |
| `tiny-finglish/normalize` | `normalize`, `foldForMatch`, `isNormalized` and normalization types |
| `tiny-finglish/metrics` | Evaluation helpers including `wordAccuracy`, `orthographicWordAccuracy`, `acceptedWordAccuracy`, `characterErrorRate` |
| `tiny-finglish/weights.json` | Weight artifact JSON, to parse before supplying `model` |
| `tiny-finglish/frequency.bin` | Uncompressed table bytes, requiring `decodeFrequencyTable` |
| `tiny-finglish/vowels.bin` | Uncompressed table bytes, requiring `decodeVowelTable` |

The package export map does not expose `src/`, arbitrary `dist/` paths, `bigram.bin`, or a lexicon asset. Use only supported paths. See [optional configuration](configurations.md) for repository-only data and [results](results.md) for the public return shape.

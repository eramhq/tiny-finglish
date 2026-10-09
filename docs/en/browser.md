---
title: "Load the hybrid engine in a browser"
description: "Fetch static model and table assets and decode them before converting."
---

# Load the hybrid engine in a browser

## Vite setup matching Eram

[Install the source archive](installation.md) into your Vite application. Enable Vite's client types (for example, `/// <reference types="vite/client" />` in `vite-env.d.ts`) so TypeScript understands `?url`. That suffix is a bundler feature, not a browser import syntax or an additional package export.

```ts
// Save as create-engine.ts in a Vite application.
import {
  Transliterator, decodeFrequencyTable, decodeVowelTable,
  type WeightArtifact,
} from "tiny-finglish";
import weightsUrl from "tiny-finglish/weights.json?url";
import frequencyUrl from "tiny-finglish/frequency.bin?url";
import vowelsUrl from "tiny-finglish/vowels.bin?url";

async function asset(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${url}`);
  return response;
}

export async function createEngine(): Promise<Transliterator> {
  const [model, frequencyBytes, vowelBytes] = await Promise.all([
    asset(weightsUrl).then(r => r.json() as Promise<WeightArtifact>),
    asset(frequencyUrl).then(r => r.arrayBuffer()),
    asset(vowelsUrl).then(r => r.arrayBuffer()),
  ]);
  return new Transliterator({
    model,
    frequency: decodeFrequencyTable(new Uint8Array(frequencyBytes)),
    vowels: decodeVowelTable(new Uint8Array(vowelBytes)),
  });
}
```

After that setup, this caller produces the recorded output:

```ts
import { createEngine } from "./create-engine";
const engine = await createEngine();
console.log(engine.transliterate("salam, emrooz miram shiraz").text);
```

```text
سلام، امروز میرم شیراز
```

The three data inputs and constructor match the website snapshot at `96b9ff39d9accff72b8d634925833a5d6f337c97`. No bigram or lexicon is loaded. Engine creation is asynchronous because the application fetches assets; `engine.transliterate()` itself is synchronous. For typing interfaces, run this loader inside a [module worker](workers.md).

## Serve the correct bytes

The archive's `.bin` exports are already decompressed. `fetch` handles HTTP content encoding; give the response's `Uint8Array` to the appropriate decoder once. The similarly named files in the repository's `data/lexicon/` are Brotli-compressed artifacts and are not interchangeable with these packaged exports.

Host assets with the correct content type, compression, cache headers, and a consistent release identity. Do not pass a URL, an `ArrayBuffer`, compressed repository bytes, or a JSON object in place of a decoded table. A TypeScript assertion on model JSON does not validate it at runtime; serve reviewed, matching artifacts.

## Other bundlers and static hosts

With another bundler, use its supported asset-URL mechanism. Without one, prebuild an ESM browser bundle and copy the three packaged data files into your static assets, then replace the URL imports with your deployed URLs. Browsers do not resolve bare package specifiers by themselves. Account for subdirectory hosting and CORS if assets are on another origin.

The runtime needs modern ES2022 JavaScript and typed arrays; this loader also needs `fetch`. No WebGPU or model service is used. Network failures, bad JSON, and decoder/constructor failures should show a retry state. Do not silently fall back to bare rules while describing the result as hybrid. See [loading and caching](workers.md) and [troubleshooting](limitations.md).

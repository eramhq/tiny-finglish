---
title: "Choose an engine configuration"
description: "Compare rules, word tables, hybrid decoding, and optional context data."
---

# Choose an engine configuration

## Compare complete configurations

This executable example uses the exported data from [Node's `hybrid.mjs` loader](node.md). Save it alongside that file. Although three setups agree on this short message, their candidates and scores differ; a single example is not an accuracy comparison.

```js
import { Transliterator } from "tiny-finglish";
import { RuleTransliterator } from "tiny-finglish/rules";
import { model, frequency, vowels } from "./hybrid.mjs";

const engines = [
  ["rules", new RuleTransliterator()],
  ["tables", new RuleTransliterator({ frequency, vowels })],
  ["hybrid", new Transliterator({ model, frequency, vowels })],
  ["model", new Transliterator({ model, frequency, vowels, hybrid: false })],
];
for (const [name, engine] of engines) {
  console.log(name + ": " + engine.transliterate("salam, emrooz miram shiraz").text);
}
```

```text
rules: سلم، امروز میرم شیرز
tables: سلام، امروز میرم شیراز
hybrid: سلام، امروز میرم شیراز
model: سلام، امروز میرم شیراز
```

## What each setup changes

Rules only requires no external data. Built-in exceptions, loanwords, token protection, and sentence processing still apply. `new Transliterator()` and `new RuleTransliterator()` share the same model-free pipeline; importing the latter from `/rules` avoids including the neural runtime.

Frequency data ranks common Persian words and builds the rule engine's dictionary index. The vowel table supplies pronunciation evidence for confusable words. Load both for the documented rules-with-tables setup. Passing a vowel table alone is accepted, but it is not the table-backed configuration measured here.

Hybrid adds the model's candidates and evidence to rule-based ranking. It is the default when `model` is present, but **the library does not load weights or tables automatically**. `hybrid: true` without `model` still runs rules. Hybrid can use model spellings containing half-spaces; it does not guarantee correct half-space placement everywhere.

`hybrid: false` uses model candidate generation. Frequency reranking, vowel adjustment, loanwords, and other shared pipeline passes still run when applicable. “Model-only” therefore describes candidate generation, not the removal of all deterministic behavior. The comparison above includes both tables even for this mode.

## Optional bigrams and lexicon

`bigram` accepts a decoded `BigramTable`, allowing a sentence pass to choose among word candidates using adjacent-word scores. `lexicon` accepts a `ReadonlySet<string>` of Persian spellings and affects rule ranking and sentence tie-breaking. `useLexiconSnap: true` additionally enables lexicon snapping on the model-only path; it is off by default and is not a switch for disabling all lexicon effects.

Neither optional data file is an exported package asset. For experiments inside this checkout, the following complete loading example uses repository files, decompresses Brotli, and keeps the existing model and tables. Run it from the repository root after building. It is not a browser snippet.

```js
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import {
  Transliterator, decodeBigramTable, decodeFrontCoded,
  decodeFrequencyTable, decodeVowelTable,
} from "tiny-finglish";

const read = name => readFileSync(new URL(import.meta.resolve(`tiny-finglish/${name}`)));
const unpack = name => brotliDecompressSync(readFileSync(`data/lexicon/${name}`));
const engine = new Transliterator({
  model: JSON.parse(read("weights.json").toString("utf8")),
  frequency: decodeFrequencyTable(read("frequency.bin")),
  vowels: decodeVowelTable(read("vowels.bin")),
  bigram: decodeBigramTable(unpack("fa-bigram.bin")),
  lexicon: new Set(decodeFrontCoded(unpack("fa-stems.bin"))),
});
console.log(engine.hasModel, engine.hasContext);
```

```text
true true
```

You must arrange redistribution, loading, and attribution yourself if your application uses these files. More data does not guarantee better output on your text; compare on a representative development set. The website does not load either file.

## Instance settings and reuse

`cacheSize` defaults to `2048` cached words and uses FIFO eviction. `scoring` permits advanced overrides of rule scoring; changing it changes the evaluated configuration. Keep defaults unless you are doing a measured experiment.

`hasModel` indicates model presence; `hasContext` indicates a supplied bigram table. It does not mean all sentence processing is disabled when false. Use separate instances for different scoring or data choices. Keep decode options stable on a reused instance: the word cache key omits `beamWidth` and `candidatesPerSpan`, so changing them after a word is cached may not regenerate its candidates. See [input controls](input-options.md) and [evaluation](limitations.md).

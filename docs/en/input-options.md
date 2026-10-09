---
title: "Control input and mixed text"
description: "Protect names and technical text, override detection, and choose punctuation behavior."
---

# Control input and mixed text

## Keep a word unchanged

Examples on this page are executable files placed next to [Node's `hybrid.mjs`](node.md). That loader supplies the model, frequency table, and vowel table used by the website.

```js
import { engine } from "./hybrid.mjs";
console.log(engine.transliterate("tu google bezan").text);
console.log(engine.transliterate("tu google bezan", { protect: ["google"] }).text);
console.log(engine.transliterate("google", {
  protect: ["google"], forceConvert: ["GOOGLE"],
}).text);
```

```text
تو گوگل بزن
تو google بزن
گوگل
```

`protect` and `forceConvert` match complete tokens case-insensitively, not substrings or arbitrary phrases. For ordinary Latin words, `forceConvert` takes precedence over `protect`. Explicit protection is reported as `copyReason: "english"`; there is no separate “user-protected” reason. Keep your own protection metadata if your UI needs that distinction.

A forced exact match can bypass a hard token pattern, too, after which tokenization continues. Forcing a URL or identifier does not provide a meaningful transliteration of the entire structure and can break preservation. Prefer forcing individual words.

## Preserve recognized technical spans

```js
import { engine } from "./hybrid.mjs";
console.log(engine.transliterate(
  "salam, link https://example.ir/a?x=1 va `npm install`",
).text);
console.log(engine.transliterate(
  "salam @navid ali@example.com #tehran 12.5 سلام 😀 API_KEY",
).text);
```

```text
سلام، لینک https://example.ir/a?x=1 و `npm install`
سلام @navid ali@example.com #tehran 12.5 سلام 😀 API_KEY
```

Tests cover recognized URLs, emails, mentions, hashtags, numbers, backtick-delimited code, identifiers, emoji, and non-Latin text. Once classified as `copy`, a span's output equals its input. That invariant is stronger than the detection heuristic: it does not prove every possible URL, Markdown fence, identifier, name, or English phrase will be recognized.

This is not a Markdown parser. Inline backtick examples are tested; do not infer full nested or fenced-code handling from them. Bare-domain recognition uses a finite TLD list. Unicode punctuation can be processed separately from an already-Persian word. Whitespace can change when the sentence pass joins detached suffixes; see [spans and offsets](results.md).

## English words and names need review

The detector combines a small English list, spelling patterns, capitalization, and known Finglish homographs. Words such as `man`, `to`, and `in` can be Persian despite being English words. Recognized loanwords can convert; neighboring English words may protect them again. Mid-sentence capitals often preserve a name, while sentence-initial capitals may convert. ALLCAPS may be treated as code. These are heuristics, not complete language or name detection. Add product names to `protect` and keep the original input available.

## Punctuation is applied to punctuation tokens

Despite older comments saying “in Persian runs only,” the current implementation localizes standalone punctuation tokens even in an English-only sentence:

```js
import { engine } from "./hybrid.mjs";
console.log(engine.transliterate("hello, world?").text);
console.log(engine.transliterate("hello, world?", { persianPunctuation: false }).text);
```

```text
hello، world؟
hello, world?
```

Default conversion maps `? ; ,` to `؟ ؛ ،`. Protected URL/code contents are not passed through that conversion. `persianPunctuation: false` preserves the punctuation tokens themselves. There is no per-call digit-conversion option on `transliterate`; recognized numbers are copied. The separate `normalize()` utility has different options and transforms the whole string you give it, so applying it to final mixed output can defeat preservation.

## Other per-call controls

| Option | Default | Practical effect |
|---|---|---|
| `alternatives` | `3` | Maximum whole-text alternatives; use `0` to omit them |
| `candidatesPerSpan` | `3` | Maximum candidates exposed per converted span; use a positive integer for a review UI |
| `beamWidth` | `8` | Model-only beam width; hybrid currently uses an internal fixed beam of 8; the rule pipeline does not read this option |
| `backend` | `"auto"` | Both `"auto"` and `"cpu"` currently use JavaScript on the CPU |

These controls are not input-length limits or scheduling controls. Validate sensible finite integer bounds in the application. More candidates can cost more work and cannot guarantee the intended word appears. Keep decode settings fixed for a reused instance because of [word caching](configurations.md).

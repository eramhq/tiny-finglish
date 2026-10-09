---
title: "Read results, candidates, and confidence"
description: "Use the return structure without confusing source positions or ranking scores with accuracy."
---

# Read results, candidates, and confidence

## Inspect an ambiguous word

Use [Node's hybrid loader](node.md) and save this example beside `hybrid.mjs`. It uses the default three candidates and three whole-text alternatives at the documented source revision.

```js
import { engine } from "./hybrid.mjs";
const result = engine.transliterate("hamele");
console.log(result.text);
console.log(JSON.stringify(result.alternatives));
console.log(result.confidence);
console.log(JSON.stringify(result.spans[0].candidates.map(
  ({ output, probability }) => ({ output, probability }),
)));
```

```text
حمله
["حامل","حمل"]
0.9566
[{"output":"حمله","probability":0.9566},{"output":"حامل","probability":0.0357},{"output":"حمل","probability":0.0077}]
```

`hamele` could have another intended reading, but the default returned list does not include `حامله`. This illustrates a limitation: a high score cannot recover information absent from the candidate set. Do not add a hoped-for candidate to a recorded engine result.

## Result fields

| Field | Meaning |
|---|---|
| `text` | Primary output; equal to all span outputs concatenated |
| `alternatives` | Up to the requested count of distinct whole-text suggestions, excluding `text` |
| `confidence` | Rounded geometric mean of converted-span confidence; `1` if nothing converts |
| `spans` | Ordered pieces covering the original input, including spaces and punctuation |

Whole-text alternatives replace one candidate in one span at a time, considering less-confident spans first. They are not a cross-product search or independently rescored complete sentences. They can break an agreement or join made by a sentence-level pass. The list can be shorter than requested or empty.

## Spans and source offsets

Each span has `input`, `output`, `start`, `end`, `action`, and `confidence`. `start` is inclusive and `end` exclusive, in JavaScript UTF-16 code units of the original input, not bytes, Unicode character counts, grapheme counts, or positions in the converted output. Always use `source.slice(start, end)`.

```js
import { engine } from "./hybrid.mjs";
const source = "😀 salam";
const result = engine.transliterate(source);
const word = result.spans.find(span => span.action === "convert");
console.log(word.start, word.end, source.slice(word.start, word.end), word.output);
console.log(result.spans.map(span => span.output).join("") === result.text);
console.log(engine.transliterate("sal e no").text);
```

```text
3 8 salam سلام
true
سال نو
```

The emoji occupies two code units. In `sal e no`, sentence processing drops the separate `e` and its preceding space; those spans remain in the array with empty outputs. Other joins may put several output words into one span. Do not assume one span equals one displayed word or that whitespace output always equals its input.

| Action | Additional fields and interpretation |
|---|---|
| `convert` | `candidates` with the selected output first when a positive candidate count is requested |
| `copy` | `copyReason`; output equals input |
| `punct` | Punctuation, possibly localized |
| `space` | Whitespace, possibly consumed by a join |

`copyReason` can be `url`, `email`, `mention`, `hashtag`, `number`, `code`, `emoji`, `english`, `non-latin`, or `unknown-script` in the public type. Not every declared reason is emitted by the current tokenizer. Candidates contain `output`, `probability`, and an explanatory `reason`; treat reason strings as diagnostic text, not stable machine-readable codes.

## What confidence actually measures

The rules convert ranking scores into relative weights using exponentials. Model decoding uses normalized beam scores; hybrid combines rule scores and model evidence. Vowel, loanword, and sentence passes can change these values, sometimes assigning a fixed score or `1`. Span confidence generally follows the selected candidate's score. Context can promote a candidate whose score is lower than another candidate's, so returned order need not be descending numeric probability.

The candidate list is truncated after processing, without guaranteed renormalization, and scores are rounded. Do not assume displayed probabilities sum to `1`, despite the older public type comment. Overall confidence is `exp(mean(log(max(span.confidence, 1e-9))))` over `convert` spans, rounded to four decimals. Copy, punctuation, and whitespace scores are `1` and excluded from this mean. An all-English or empty input may therefore have overall confidence `1` without testing any Persian spelling.

None of these values is calibrated real-world accuracy or a statistical confidence interval. Use them to guide review, not to claim “95% correct.” Keep [evaluation metrics](limitations.md) separate from UI confidence.

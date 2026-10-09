---
title: "Build a review interface"
description: "Keep original input, show alternatives safely, and copy the reviewed result."
---

# Build a review interface

## Keep input and output separate

Store the exact original input and its revision separately from the latest engine result and the user's choices. Show output as a preview; do not overwrite the typing field on every keystroke. A user needs to recover the source when a name or ambiguous word is wrong.

Render text with `textContent` or framework text interpolation. Engine output is user-derived text, not trusted HTML. Set the output container's language to Persian and direction to RTL; isolate copied Latin runs using bidi-aware DOM elements. Keep code and input suitable for LTR or automatic direction. The [playground source](../../playground/src/main.ts) shows selectable spans and keyboard handling, but is not a required UI dependency.

## Apply a reviewed candidate

This TypeScript helper is a UI excerpt: it requires a [result](results.md) from a configured engine and a choices map owned by your application. It performs no conversion and has no model/data imports of its own.

```ts
import type { TransliterationResult } from "tiny-finglish";

export function reviewedText(
  result: TransliterationResult,
  choices: ReadonlyMap<number, string>,
): string {
  return result.spans.map((span, index) => {
    const choice = choices.get(index);
    return choice !== undefined && span.action === "convert" &&
      span.candidates?.some(candidate => candidate.output === choice)
      ? choice : span.output;
  }).join("");
}
```

Key choices by span index only within one result revision. Clear them whenever the source text, protection options, engine configuration, or result changes. More advanced retention must verify the original token and its location; an offset alone is unsafe after edits. Do not splice candidates into output using source offsets.

With the verified `hamele` result from [the results guide](results.md), choice `new Map([[0, "حامل"]])` produces `حامل` through this helper. That is a user-selected spelling, not a new engine prediction. Editing candidates locally does not rerun sentence scoring, change `result.confidence`, or learn a preference. Offer whole-text `alternatives` as separate suggestions, and label the displayed text when it has been edited.

## Make review accessible

Provide focusable controls for converted spans that have alternatives, support Enter/Space, let Escape close the chooser, and return focus to the invoking control. Display source text alongside the candidate list. Announce conversion and loading status without reading the entire message after each keystroke. Skip empty-output spans as interactive words, while retaining them in your result data.

A threshold for highlighting uncertainty is an application choice, not a library guarantee. Label the score as a ranking signal; do not display it as the chance a spelling is correct. Candidate reason strings are primarily diagnostics and can be too technical for visitors.

## Copy the displayed text

Use `navigator.clipboard.writeText(reviewedText(result, choices))` in a user-triggered handler, await it, and report success only after it resolves. Clipboard permissions or an insecure context can cause rejection; offer manual selection and copying. If the user edits a plain output field, copy that current field value instead. Never copy a stale result or hidden original by accident.

Input limits, debouncing, cancellation, persistence, analytics, clipboard access, and retry UI are application responsibilities. The website's input limit is 400 characters; it is not a library limit. See [worker integration](workers.md) to keep typing responsive and suppress stale results.

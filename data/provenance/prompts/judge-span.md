# Task: judge whether a transliteration difference is acceptable

You are one of two independent judges for a Finglish (Persian typed in Latin
letters) to Persian-script transliterator. For each item, a word-level
comparison found a run where the system's output differs from the reference.
Decide whether the system's run is an **acceptable** rendering of what was
typed. Another model family judges the same items; a difference is forgiven
only if both of you accept it, so reject anything you are not sure about.

## Input

`{SHARD}` — JSONL, one item per line:

```json
{"key", "id", "input", "reference", "hypothesis", "refSpan", "hypSpan"}
```

- `input`: the Finglish sentence a human typed.
- `reference`: the Persian sentence the dataset pairs with it.
- `hypothesis`: the system's full output, for context.
- `refSpan` / `hypSpan`: the differing run. Either may be `""` (a word the
  system dropped or added).

## Accept only these two kinds of difference

1. `orthographic` — the same word(s), spelled with a convention Persian writers
   genuinely vary on: آ/ا at word start, hamza forms (رئیس/رییس, مسئله/مساله),
   joined vs separated affixes (میکنم/می کنم, کتابها/کتاب ها, خانهاش/خانه اش),
   digits vs the same number in words. Not: a different letter that makes a
   different or misspelled word (ع dropped, ح→ه, ص→س, ط→ت, missing long vowel).
   A misspelling is wrong even if a reader could guess it.
2. `faithful` — the reference uses a different register or word than what was
   typed, and the system's run is a correct Persian spelling of **what the
   typist actually typed**: typed `agar`, reference `اگه`, system `اگر`; typed
   `mikhaham`, reference `میخوام`, system `میخواهم`. The system's word must be
   spelled correctly.

Everything else is `reject`: wrong words, misspellings, wrong word splits that
produce non-words, English left untransliterated when the reference has
Persian (unless the typist typed an English word the reference also writes in
Latin), dropped or extra words that the typing does not justify.

**Judge from `input` and `reference` yourself.** Do not write a program or
heuristic to decide verdicts; scripts only to read the shard and validate your
output.

## Output

Write `{OUT}` as JSONL, one line per item, every key present:

```json
{"key": "...", "verdict": "accept|reject", "category": "orthographic|faithful|"}
```

`category` is required for `accept` and empty for `reject`. Print per-verdict
counts when done.

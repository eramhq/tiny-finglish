# Task: audit whether Finglish ↔ Persian pairs are the same sentence

You are one of two independent judges auditing an evaluation set for a Finglish
(Persian typed in Latin letters) to Persian-script transliterator. Another model
family audits the same rows separately. A row is removed from the evaluation
only if both judges independently say it is misaligned, so be careful in both
directions: do not flag a row that is merely hard, and do not pass a row whose
two sides are different sentences.

## Input

`{SHARD}` — JSONL, one row per line: `{"id", "input", "expected"}`.

- `input` is Finglish that a human typed.
- `expected` is the Persian sentence (Mozilla Common Voice) the dataset pairs
  with it. The source is known to contain rows where the two sides are
  different sentences even though they have similar word counts.

You see only the two sides of each row. You are not shown, and must not
produce or run, any transliteration engine output. **Read each row yourself;
do not write a program or heuristic to decide verdicts.** Scripts are allowed
only to read the shard and validate your output file.

## Verdicts

- `aligned` — the same sentence. Allow: words joined or split differently
  (`aan ha` / `آنها`, `mi konam` / `میکنم`), formal typing over a colloquial
  reference or the reverse (`agar` / `اگه`, `mikhaham` / `میخوام`), typos, bad
  or missing vowels, English-keyboard spellings, digits vs number words, and
  one small word added or dropped.
- `partial` — mostly the same sentence, but a clause or two or more content
  words are present on one side only, or a substantive stretch differs.
- `misaligned` — the two sides are different sentences, or less than about
  half of either side corresponds.

A difficult but genuine rendering is `aligned`. Register differences are never
by themselves a reason for `partial` or `misaligned`.

## Output

Write `{OUT}` as JSONL, one line per input row, same order, every id present:

```json
{"id": "gold-0001", "verdict": "aligned|partial|misaligned", "note": "..."}
```

`note`: at most 12 words, required for `partial` and `misaligned` (say what
differs), empty otherwise.

When you finish, print one summary line: counts per verdict.

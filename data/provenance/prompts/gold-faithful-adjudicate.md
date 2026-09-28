# Task: adjudicate two `faithful` references for Finglish ↔ Persian pairs

Two independent writers were given the same Finglish ↔ Persian rows and wrote,
for each, a `faithful` reference. Their texts differ on the rows you are given.
You choose, blind: the two proposals are labelled `A` and `B` in an order that
was randomised per row, and you are not told which writer wrote which.

## Input

`{BLIND}` — JSONL, one row per line:
`{"id", "source": {"input", "expected"}, "A": "...", "B": "..."}`.

- `input` is Finglish that a human typist wrote while listening to or reading
  a Persian sentence.
- `expected` is the Persian sentence the row is scored against. The row has
  already been audited as the same sentence as its `input`.

## The rules the writers were given

`faithful` — `expected` minimally edited so that it is what the typist
actually typed, word by word:

- change a word only when the typing clearly says a different word or form:
  typed `agar` over `اگه` → `اگر`; typed `mikhaham` over `میخوام` → `میخواهم`;
- insert a word the typist typed that the reference lacks, delete a word the
  reference has that the typist did not type;
- if a typed word is a misspelling of the reference word, keep the reference
  word — `faithful` is Persian as the typist *meant* it;
- otherwise keep the reference's exact spelling and its joining conventions
  (it writes `میکنم` solid with no ZWNJ; do the same). Never add U+200C;
- use Persian `ی` (U+06CC) and `ک` (U+06A9), no diacritics;
- numbers: follow the typing — digits if digits were typed, words if words.

If the typing matches the reference exactly, `faithful` equals `expected`.

## What to do for every row

Read the row and both proposals yourself and decide which one follows the
rules better. **Do not write a program or heuristic to decide.** Scripts are
allowed only to read the file and to validate your finished output.

- Prefer the proposal that changes less, unless the typing clearly says the
  other form. Minimal edit is the point.
- Where the reference's own spelling carries a mark the rules do not ask to
  remove (hamza on ه as in `خانهٔ`, a plain ا for آ), keeping it is correct.
- If neither proposal is right, write your own text and mark it `edited`.
  Do this only when both are clearly wrong, not for taste.

## Output

Write `{OUT}` as JSONL, one line per input row, same order, every id present:

```json
{"id": "...", "chose": "A|B|edited", "faithful": "...", "why": "..."}
```

`faithful` is the chosen text, copied exactly (or your own, for `edited`).
`why`: at most 12 words.

When you finish, print one summary line: counts of A, B and edited.

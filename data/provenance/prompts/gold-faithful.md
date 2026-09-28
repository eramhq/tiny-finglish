# Task: write a `faithful` reference for Finglish ↔ Persian sentence pairs

You are one of two independent writers adding a second reference to an
evaluation set for a Finglish (Persian typed in Latin letters) to
Persian-script transliterator. Another model family writes the same rows
separately; disagreements are adjudicated by a third reviewer. Accuracy
matters more than speed.

## Input

`{SHARD}` — JSONL, one row per line: `{"id", "input", "expected"}`.

- `input` is Finglish that a human typist wrote while listening to or reading
  a Persian sentence.
- `expected` is the Persian sentence (Mozilla Common Voice) the row is scored
  against. Every row has already been audited as the same sentence as its
  `input`, so do not judge alignment and do not trim anything.

The problem this fixes: the typist often typed a different *register* from the
reference — formal `mishavad` over colloquial `میشه`, or the reverse. No
transliterator can recover the reference's form from such typing, so a score
against `expected` alone mixes accuracy with register.

## What to do for every row

Read both sides yourself and write `faithful`. **Do not write a program,
heuristic, or word-count rule to produce text.** Scripts are allowed only to
read the shard and to validate your finished output (JSON syntax, every id
present). Do not run any transliteration tool.

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

If the typing matches the reference exactly, `faithful` equals `expected`,
character for character. Keep the reference's punctuation as it is.

## Output

Write `{OUT}` as JSONL, one line per input row, same order, every id present:

```json
{"id": "...", "faithful": "..."}
```

## Examples

```json
{"id":"x1","faithful":"اون زن یک جورهایی لخت است"}
{"id":"x2","faithful":"نمیدونم چی بگم"}
```

In `x1` the row was `oon zan yek joor haei lokht ast` against `اون زنه یه
جورایی لخته`: `yek` is `یک`, not `یه`, and `lokht ast` is `لخت است`, while
`oon` really is the colloquial `اون` and stays. In `x2` the typing was
`nemidoonam chi begam` against `نمیدونم چی بگم`, so nothing changes.

When you finish, print one summary line: rows written, and how many differ
from `expected`.

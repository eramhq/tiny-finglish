# Task: label and repair Finglish ↔ Persian sentence pairs

You are one of two independent judges building a development set for a Finglish
(Persian typed in Latin letters) to Persian-script transliterator. Another model
family labels the same rows separately; disagreements are adjudicated by a
third reviewer. Accuracy matters more than speed.

## Input

`{SHARD}` — JSONL, one row per line: `{"id", "input", "expected"}`.

- `input` is Finglish that a human typist wrote while listening to or reading
  a Persian sentence.
- `expected` is a Persian sentence from Mozilla Common Voice that the source
  dataset *claims* is the same sentence. Often it is not: the dataset is known
  to be misaligned, sometimes shifted by one row, sometimes with extra or
  missing clauses.

## What to do for every row

Read both sides yourself and decide how they correspond. **Do not write a
program, heuristic, or word-count rule to decide verdicts or produce text.**
Scripts are allowed only to read the shard and to validate your finished output
(JSON syntax, span checks). Do not run any transliteration tool.

Pick one verdict:

- `aligned` — the Finglish renders the whole Persian sentence. Allow: words
  joined or split differently (`aan ha` / `آنها`, `mi konam` / `میکنم`),
  formal typing over a colloquial reference or the reverse (`agar` / `اگه`),
  typos, and one or two small words added or dropped.
- `trimmable` — one or both sides have extra material at the **start and/or
  end**, but a contiguous run of at least 2 words on each side is the same
  sentence. Give those runs.
- `misaligned` — different sentences, or less than about half of either side
  corresponds, or the corresponding words are not contiguous.

## Output fields

Write `{OUT}` as JSONL, one line per input row, same order, every id present:

```json
{"id": "...", "verdict": "aligned|trimmable|misaligned", "input": "...", "expected": "...", "faithful": "...", "note": "..."}
```

- `input` — a **character-exact contiguous run of whitespace-separated words**
  copied from the row's `input`. Do not change spelling, case or punctuation.
  For `aligned`, the whole input.
- `expected` — a **character-exact contiguous run of whitespace-separated
  words** copied from the row's `expected`. For `aligned`, the whole sentence.
- `faithful` — `expected` minimally edited so that it is what the typist
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
- For `misaligned`: `input`, `expected` and `faithful` are `""`.
- `note` — at most 12 words; say what was trimmed or why it is misaligned.
  Empty for clean `aligned` rows.

## Examples

```json
{"id":"x1","verdict":"aligned","input":"oon zan yek joor haei lokht ast","expected":"اون زنه یه جورایی لخته","faithful":"اون زن یک جورهایی لخت است","note":"formal typing over colloquial reference"}
{"id":"x2","verdict":"misaligned","input":"","expected":"","faithful":"","note":"different sentences"}
{"id":"x3","verdict":"trimmable","input":"nemidoonam chi begam","expected":"نمیدونم چی بگم","faithful":"نمیدونم چی بگم","note":"source input began with unrelated words: vali to"}
```

In `x3` the source row's input was `vali to nemidoonam chi begam` against the
reference `نمیدونم چی بگم`; the two leading words have no counterpart, so
`input` is trimmed to the corresponding run.

When you finish, print one summary line: counts per verdict.

# Task: type Persian sentences in Finglish, the way real people do

You are role-playing Persian speakers typing their language on an English
keyboard ("Finglish"). The output trains and tests a small transliterator, so
it must look like **real human typing**, not like a romanization standard.

## Input

`{SHARD}` — JSONL, one sentence per line: `{"id", "words": ["...", ...]}`, the
Persian sentence already split into words.

## Output

`{OUT}` — JSONL. For **every input sentence**, write one line **per persona
listed below**, in the listed order:

```json
{"id": "...", "persona": "careful-aa", "finglish": ["...", "..."]}
```

- `finglish` has **exactly one string per Persian word, same order**. A string
  may contain a space when the typist would detach an affix: `mi konam` for
  میکنم, `ketaab haa` for کتابها. A typed ezafe belongs to the word it follows:
  `ketab e` for کتاب in کتاب من. Never merge two Persian words into one string
  or split one across two.
- Lowercase ASCII letters, apostrophe and space only. No digits, no hyphens,
  no punctuation.
- Type **what is written**, word for word. Do not translate, colloquialize or
  formalize. If the Persian is formal (میخواهم), type the formal word
  (`mikhaaham`/`mikham` is wrong); if it is colloquial (میخوام), type that.
- Read the Persian as a native speaker would pronounce it, then spell that
  pronunciation in the persona's habits. Short vowels are not written in
  Persian; the typist still types them (`ketaab` for کتاب).
- Vary naturally within a persona. Real typists are inconsistent: the same
  person writes `kheili` and `khayli` in one message.

Personas for this shard: `{PERSONAS}` (write them in this order for every sentence).

## Persona cards

Version 2. Version 1's four caricatures (`careful-aa`, `casual-a`, `ou-eh`,
`keyboard`) were measured against the dev set's human typing and each missed
it badly. For example, one wrote `aa` 38 times per 100 words where the human
writes it 18 times, and another wrote `u` 7 times where the human writes it
0.3. They were also 10–17 points easier to convert than the human. These two
cards are calibrated to the human's measured rates instead. Hit the rates;
do not exaggerate a habit.

**everyday** — the typical typist (target rates per 100 words in brackets).
- Long ا/آ: `a` a little more often than `aa`, mixed within one sentence
  (`aa` ≈ 15 per 100 words). `ketab` and `ketaab` both happen.
- Long و: mostly `oo` (`khoob`, `doost`), fairly often `ou` (`khoub`), rarely
  `u` (`u` ≈ 0.3 per 100 words, so almost never).
- Long ی: `i`; `ee` almost never.
- Word-final silent ه: `e`; `eh` only occasionally (≈ 1 per 100 words).
- ع and ء: simply not typed; no apostrophes. خ `kh`, ق/غ `gh`, ک `k`, ش `sh`,
  چ `ch`. Never `q`, `x`, `w` or `c`.
- Often types the ezafe as its own word or glued: `ketab e man`, `ketabe man`.
  Detaches `ha`/`haa`/`haye`, sometimes `mi`, as real typists do
  (≈ 11 detached pieces per 100 words).
- About 1 word in 20 has a natural slip: a dropped short vowel (`bayd`), a
  doubled or missing letter, or the wrong short vowel (`kheyli`/`khayli`).

**careful** — a more deliberate typist.
- Long ا/آ: `aa` about half the time (`baazaar`, `aab`), otherwise `a`.
- Long و: `oo` mostly, `ou` sometimes. Long ی: `i`.
- Final silent ه: `e`. ع: dropped, with an apostrophe very rarely (`sa'at`).
- Ezafe usually glued (`ketaabe man`). Detaches `haa` sometimes.
- About 1 word in 40 has a slip.

When you finish, print the number of lines written.

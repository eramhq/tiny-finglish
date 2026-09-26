# Task: list the abbreviations Persians use when texting in Finglish

You are a native Persian speaker (Tehran, everyday chat). When Persians text in
Finglish on a phone they shorten common words, mostly by dropping vowels —
`slm` for سلام, `mmnon` for ممنون — and they use a few chat abbreviations
borrowed from English. A small Finglish -> Persian transliterator reads these
letter by letter and gets them wrong. The list you write becomes a lookup
table that fixes that.

## Output

`{OUT}` — JSONL, one entry per line:

```json
{"en": "slm", "fa": "سلام", "kind": "skeleton"}
```

Write **about {COUNT} entries** in total.

## What an entry is

- `en` is the abbreviation exactly as typed: lowercase, letters only, one
  token, no spaces, digits or punctuation.
- `fa` is what the texter means, written the way it is written in Persian
  chat: ی and ک, no diacritics, no half-space (write میخوام, not می‌خوام). If
  the abbreviation stands for a short phrase, write the phrase with spaces,
  and only when that abbreviation is really common.
- `kind` is `skeleton` (vowels dropped from a Persian word: `slm`, `mrc`,
  `mmnon`, `khbi`), `english` (an English chat abbreviation Persians use:
  `pm`, `dm`, `ok`), or `other`.
- Only abbreviations **you are confident real Persian texters use**. A
  plausible-looking skeleton nobody types does not belong here.
- **Skip anything that is also an ordinary Finglish spelling of a different
  word.** `bd` could be بد or بعد, `mn` could be من or مِن — if the letters are
  genuinely ambiguous between two common words, skip it. It is better to miss
  an abbreviation than to hijack a Persian word.
- **Skip full spellings.** `salam`, `merci`, `khubi` are not abbreviations.
- No duplicates. Each `en` once; if one abbreviation has two meanings, it is
  ambiguous — skip it.

Cover greetings and thanks, questions (how are you, where are you, what's up),
yes/no/ok, apologies, common verbs (بگو, باشه, میام, نمیدونم), time words, and
feelings — whatever texters actually shorten.

Rules: write the list yourself from your own knowledge. Never write or run
code that generates entries. Read only this prompt and `{OUT}`. Append to
`{OUT}` with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~50 lines. When
done, print the count per kind.

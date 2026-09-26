# Task: review a loanword table

You are a native Persian speaker (Tehran, everyday chat) who also reads
English, reviewing a table another model wrote. Each entry says: when a
Persian types this English word in a Finglish chat message, they mean this
Persian word. A Finglish -> Persian transliterator will **always** write the
entry's Persian when it sees the English spelling, so a wrong entry breaks
real messages.

## Input

`{IN}` — JSONL, one entry per line: `{"en": "backup", "fa": "بکاپ", "category": "tech"}`.

## Output

`{OUT}` — JSONL, exactly one line per input line, same order:

```json
{"en": "backup", "verdict": "accept", "reason": ""}
```

`verdict` is `accept` or `reject`. Give a short `reason` (English) for every
reject.

**Accept** only when all three hold:

1. **The Persian is the spelling Persians use in chat** for this loanword —
   the common one, the one you would type yourself (ی and ک, no diacritics;
   compounds written solid, without a half-space, are fine: لپتاپ).
2. **The English spelling is common**: a Persian who knows English would
   plausibly type this word this way in a Finglish message, meaning the
   loanword.
3. **The English spelling does not also read as a different, common Persian
   word** in Finglish. `bad` is بد, `man` is من, `name` is نامه, `mast` is
   ماست, `car` is کار: those must be rejected even though they are English.

**Reject** when any of these holds:

- the Persian is misspelled, uncommon, or a purist form nobody types in chat;
- Persians do not really use this loanword (they use a native word instead);
- the English spelling is rare, wrong, or not how anyone would type it;
- the English letters are also ordinary Finglish for another Persian word;
- it is a brand or product name, **unless** its `category` is `brand` (see
  below);
- it is not a single word, or the Persian carries a Persian ending (لپتاپم).

**Entries with `category: brand`** are a deliberate, hand-picked short list of
brands so famous in Iranian chat that they are normally written in Persian
(اینستاگرام, تلگرام). Do not reject them for being brands. Judge them on the
same three points: is this the Persian spelling people use, is the English
spelling the one people type, and does it collide with a Persian word.

Do **not** reject for: a missing half-space, or another common Persian
spelling of the same word also existing — accept the entry if its own
spelling is a common one.

Rules: judge every line yourself by reading it. Never write or run code that
produces verdicts. Read only this prompt, `{IN}` and `{OUT}`. Append to `{OUT}`
with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~50 lines. When done,
print the counts of accept and reject.

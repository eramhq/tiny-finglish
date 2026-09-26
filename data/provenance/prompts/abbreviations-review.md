# Task: review a table of Finglish texting abbreviations

You are a native Persian speaker (Tehran, everyday chat) reviewing a table
another model wrote. Each entry says: when a Persian texting in Finglish types
these letters, they mean this Persian. A Finglish -> Persian transliterator
will **always** write the entry's Persian when it sees the letters, so a wrong
entry breaks real messages.

## Input

`{IN}` — JSONL, one entry per line: `{"en": "slm", "fa": "سلام", "kind": "skeleton"}`.

## Output

`{OUT}` — JSONL, exactly one line per input line, same order:

```json
{"en": "slm", "verdict": "accept", "reason": ""}
```

`verdict` is `accept` or `reject`. Give a short `reason` (English) for every
reject.

**Accept** only when all three hold:

1. **Real texters use it**: you have seen Persians type these exact letters for
   this meaning in Finglish chat.
2. **The Persian is right**: it is what the abbreviation means, spelled the
   way people write it in chat (ی and ک, no diacritics; a missing half-space is
   fine).
3. **It is not ambiguous**: the letters are not also a common way to type a
   *different* Persian word or abbreviation. `bd` (بد or بعد) must be
   rejected; so must letters that are an ordinary Finglish word (`man`, `to`).

**Reject** when any of these holds: nobody really types it; the Persian is
wrong or misspelled; the letters are ambiguous; it is a full spelling, not an
abbreviation (`salam`); it contains anything but lowercase letters.

Rules: judge every line yourself by reading it. Never write or run code that
produces verdicts. Read only this prompt, `{IN}` and `{OUT}`. Append to `{OUT}`
with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~50 lines. When done,
print the counts of accept and reject.

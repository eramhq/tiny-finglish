# Task: review Persian chat messages

You are a native Persian speaker reviewing short chat messages (Telegram /
WhatsApp style, Tehran colloquial) that another model wrote. They will be used
as Persian text in a transliteration dataset, so each must be something a real
person would type in chat, spelled correctly for colloquial Persian.

## Input

`{IN}` — JSONL, one message per line: `{"id": "...", "text": "..."}` (other
fields may be present; ignore them).

## Output

`{OUT}` — JSONL, exactly one line per input line, same order:

```json
{"id": "...", "verdict": "accept", "reason": ""}
```

`verdict` is `accept` or `reject`. Give a short `reason` (English) for every
reject.

**Accept** when the message is natural colloquial Persian that a native speaker
could plausibly send in a chat, and every word is spelled acceptably for chat.

**Reject** when any of these holds:

- a misspelled word (not a colloquial spelling — a real error: خاستن for
  خواستن, ي/ك Arabic letters, a missing or extra letter);
- unnatural or ungrammatical Persian, a calque, or a phrase no native speaker
  would say;
- written/formal register where the rest is colloquial in a way nobody types
  (می‌خواهم mixed into chat is fine only if it reads naturally);
- not a chat message at all (a headline, a definition, a list of words);
- contains Latin letters, digits, emoji, or diacritics.

Do **not** reject for: missing punctuation, a missing or present half-space
(میخوام and می‌خوام are both fine), slang, colloquial spellings (خونه، اینجاس،
خستم، نمیدونم), or being very short (a single word like باشه is a fine message).

Rules: judge every line yourself by reading it. Never write or run code that
produces verdicts. Read only this prompt, `{IN}` and `{OUT}`. Append to `{OUT}`
with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~50 lines. When done,
print the counts of accept and reject.

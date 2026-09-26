# Task: write the Persian side of a chat test set

You are a native Persian speaker (Tehran colloquial) writing messages that real
people send each other in Telegram and WhatsApp. These become the **reference
Persian of a test set** for a Finglish -> Persian transliterator: someone will
later type each message in Finglish, and the engine is scored on getting your
Persian back. So each message must be exactly what a Persian speaker would
write, spelled consistently.

## Output

`{OUT}` — JSONL, one message per line:

```json
{"id": "{PREFIX}-001", "scene": "family", "text": "مامان کی میای خونه", "alternatives": []}
```

Number ids from 001 in order. Write **{COUNT} messages for each scene below**:

{SCENES}

## Spelling convention — follow it exactly

The test is scored word by word, so the reference spelling is a convention:

- **No half-space (ZWNJ) anywhere in `text`.** Join prefixes and suffixes
  solid, the way most people type in chat: میخوام، نمیدونم، میرم، کتابها،
  خونشون. Write compounds as two words where people put a space: دوست دارم.
- No diacritics, no tanvin, ی and ک only (never ي or ك). Numbers as words.
- Colloquial spoken Persian, never written register: میخوام not می‌خواهم,
  اون not آن, رو not را, خوبه not خوب است, کجاست or کجاس as you would text it.
- Punctuation as in chat: often none, sometimes ? ! or ، — the scorer ignores
  punctuation, so use it naturally.
- No emoji, no Latin letters, no digits.

`alternatives`: when a word in the message has a **different spelling that is
equally correct and common** in chat, give the whole message again with that
spelling — at most three alternatives, each a full message. Typical cases:
آره / اره, the ZWNJ spelling (می‌خوام for میخوام, کتاب‌ها for کتابها),
اینجاس / اینجاست. Leave the list empty when there is no such variant. Do not
list paraphrases or different words — only spellings of the same words.

## What a message looks like

- Short: most 2-8 words, some single words, a few up to ~14.
- Each stands alone as one turn in a conversation. Vary openings, verbs,
  people, places and times; no near-duplicates.
- Include, across the set, the things chat is made of: greetings and thanks,
  questions (کجایی، چیکار میکنی), the copula on a word (خوبه، کتابه، مال منه),
  colloquial verbs (میام، نمیدونم، بریم), slang (دمت گرم، حله، ایول), and
  loanwords written in Persian (اوکی، مرسی، لایک، مسیج).

## Scenes

{SCENE_NOTES}

Rules: write every message yourself. Do not use a script, a word list or any
code to produce messages. Do not read any file other than this prompt. Append
to `{OUT}` with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~40 lines.
When done, print the line count.

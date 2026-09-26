# Task: write Persian chat messages that end in the colloquial copula

You are a native Persian speaker (Tehran colloquial) writing the messages
people send each other in Telegram and WhatsApp. The lines teach a small
Finglish -> Persian transliterator one thing it gets wrong: in chat, "it is" is
written as a ه on the word before — کتابه ("it's a book"), ماشینه, گرونه,
مال منه — and the model keeps writing the bare word (کتاب) instead.

## Output

`{OUT}` — JSONL, one message per line:

```json
{"id": "{PREFIX}-001", "topic": "copula", "text": "این کتاب منه"}
```

Write **{COUNT} messages**, ids from 001.

## What every message must have

- **It ends in a word carrying the copula ه**, written joined to the word:
  کتابه، ماشینه، دفتره، کیفه، گوشیه، خوبه، گرونه، قشنگه، دیره، سرده، بازه،
  تعطیله، مال منه، مال توئه. (After a vowel people write ـه‌س / ـست / ـئه — خونه‌س،
  اینجاست، توئه — include some, but most should be a consonant + ه.)
- **Mostly nouns**, because that is the model's gap: things (کتاب, ماشین,
  کلید, لپتاپ, کفش, بلیط), places (پارک, رستوران, فرودگاه), people
  (دوستمه، داداشمه، استاده), food, animals. Prefer words that do not already
  end in ه. About two thirds nouns, one third adjectives.
- **Short**: 1-6 words. Some are a single word (کتابه؟ / ماشینه). Questions
  are good: این کیفه؟ ، مال کیه؟
- Colloquial register throughout, spelled as people type on a phone: no
  diacritics, ی and ک only, half-space optional. Punctuation as in chat.
  No Latin letters, digits or emoji.
- **Vary the words.** Use a different noun or adjective in nearly every line;
  at most three lines may end in the same word. Do not use کتابه more than
  twice.

Rules: write every message yourself; no scripts, word lists or code that
produce messages. Read only this prompt. Append to `{OUT}` with a quoted
heredoc (`cat >> {OUT} <<'EOF'`) every ~40 lines. When done, print the line
count.

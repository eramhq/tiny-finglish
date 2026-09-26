# Task: write Persian chat messages, the way people really text

You are a native Persian speaker (Tehran colloquial) writing the messages
people send each other in Telegram and WhatsApp. The lines train a small
Finglish -> Persian transliterator, so what matters is that they are the
Persian people really type in chat: colloquial, short, and spelled the way a
Persian keyboard user spells them.

## Output

`{OUT}` — JSONL, one message per line:

```json
{"id": "{PREFIX}-001", "topic": "greeting", "text": "سلام خوبی؟ چه خبر"}
```

Number ids from 001 in order. Write **{COUNT} messages for each topic below**:

{TOPICS}

## What a message looks like

- **Colloquial spoken Persian, never written register.** میخوام not می‌خواهم,
  میرم not می‌روم, نمیدونم not نمی‌دانم, اون not آن, رو not را, کتابه not
  کتاب است, خونه not خانه (where people say خونه).
- **Short.** Most messages 1-8 words; some single words (باشه, مرسی, اوکی);
  a few up to ~15. Real chat turns are short.
- Spelled as people type on a phone: no diacritics (no َ ُ ِ), no tanvin, ی
  and ک (never ي or ك). The half-space is optional, as it is in real chat: write
  میخوام or می‌خوام, whichever you would type; mix freely.
- Punctuation as in chat: often none, sometimes ? or ! or ، at the end or in the
  middle. No emoji, no Latin letters, no digits (write numbers as words:
  ساعت پنج).
- Each message stands alone as one turn in a conversation. Vary the openings;
  do not start every line with سلام.
- **Vary the vocabulary.** Every line should teach something the others don't:
  different verbs, people, places, times, feelings. Do not write near-duplicates
  (سلام خوبی / سلام خوبی؟ / سلام خوبین count as one).

## Topics

- `greeting` — greetings, how-are-you, thanks, goodbyes, good night: سلام،
  خوبی، مرسی، ممنون، قربونت، فدات، خداحافظ، شب بخیر.
- `plans` — making plans and time: فردا میای؟، ساعت چند، کی برمیگردی،
  بریم سینما، دیر میرسم.
- `questions` — asking and answering: کجایی، چیکار میکنی، چی شد، چرا
  نیومدی، کی گفته.
- `feelings` — moods and feelings: خستم، حوصلم سر رفته، دلم برات تنگ شده،
  خیلی خوشحالم، اعصابم خورده.
- `slang` — slang and idioms: دمت گرم، ایول، باحاله، حله، خیالت راحت،
  چاکریم، دستت درد نکنه، ول کن بابا.
- `copula` — the colloquial copula and clitics written onto the word:
  کتابه، خوبه، اینجاست، مال منه، خونه‌س، چطوره، کیه، چیه، خستس، گرونه.
  At least half the messages in this topic end in such a word.
- `short` — one- to three-word turns: باشه، اوکی، آره، نه بابا، چشم،
  حتما، مرسی عزیزم، الان میام، کجایی.
- `loanwords` — English and French loanwords as Persians write them in Persian
  script: اوکی، مرسی، سیو کن، لایک، فالو، استوری، مسیج بده، لینک رو بفرست،
  پسورد، گوشیم شارژ نداره.

Rules: write every message yourself. Do not use a script, a word list or any
code to produce messages. Do not read any file other than this prompt. Append
to `{OUT}` with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~40 lines.
When done, print the line count.

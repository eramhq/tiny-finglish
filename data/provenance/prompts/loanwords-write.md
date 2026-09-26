# Task: list loanwords Persians type with their English spelling

You are a native Persian speaker (Tehran, everyday chat) who also reads
English. Persians texting in Finglish often type a loanword the **English**
way — `backup`, `cake`, `laptop`, `email` — while meaning the Persian word
written in Persian script: بکاپ، کیک، لپتاپ، ایمیل. A small Finglish ->
Persian transliterator reads those letter by letter and gets them wrong
(`cake` -> کاک, `backup` -> بککوپ). The list you write becomes a lookup table
that fixes that.

## Output

`{OUT}` — JSONL, one entry per line:

```json
{"en": "backup", "fa": "بکاپ", "category": "tech"}
```

Write **about {COUNT} entries for each category below**:

{CATEGORIES}

## What an entry is

- `en` is the word **as a Persian would type it in English letters when they
  know the English spelling**: the ordinary English spelling, lowercase, one
  word, letters only (no spaces, hyphens, digits or apostrophes). If a common
  alternative English spelling is also typed (`ok`/`okay`, `wifi`), give it as
  its own entry.
- `fa` is how that loanword is **written in Persian in chat and on the web**:
  the common spelling, not a dictionary-purist one. ی and ک (never ي or ك), no
  diacritics, **no half-space** — write compounds solid (لپتاپ، پاوربانک).
- Only words Persians **really use as loanwords** in everyday speech. `laptop`
  (لپتاپ) yes; `car` no — Persians say ماشین, not کار. If the Persian word is a
  native one, the entry does not belong here.
- The bare word only: singular, no Persian endings (`laptop`, not `laptopam`).
  A plural only when the loanword itself is used in the plural form in Persian
  (rare).
- **No brand or product names** (instagram, google, samsung, netflix): those
  are handled separately.
- **Skip a word whose English spelling is also a common Finglish spelling of a
  different Persian word**: `bad` (بد), `man` (من), `name` (نامه), `mast`
  (ماست), `car`/`kar` (کار), `shirt`… when in doubt, skip it. It is better to
  miss a loanword than to hijack a Persian word.
- Prefer words with an English spelling that a letter-by-letter reading would
  get wrong (silent e, `ck`, `ph`, `ea`, `oo`, doubled letters, `c` for ک/س,
  `u` for آ) — but a common loanword with a plain spelling is fine too.
- No duplicates. Each `en` once.

## Categories

- `tech` — computers, phones, the internet: backup, laptop, email, password,
  update, download, charger, file, folder, mouse, keyboard, wifi, ...
- `social` — social media and chat: like, follow, story, post, comment,
  message, block, unfollow, page, live, ...
- `food` — food and drink: pizza, cake, coffee, sandwich, burger, sauce, ...
- `shopping` — shopping and money: online, delivery, discount, shop, brand,
  size, card, ...
- `clothes` — clothes and fashion: jacket, jeans, tshirt, hoodie, style, ...
- `sport` — sport and the gym: football, gym, coach, offside, penalty, ...
- `school` — school, university, work: project, deadline, meeting, class,
  professor, exam, office, ...
- `cars` — cars and transport: taxi, bus, metro, gearbox, bumper, ...
- `health` — health and doctors: doctor, clinic, test, vitamin, ...
- `chat` — everyday chat words: ok, merci, sorry, bye, cool, happy, ...

Rules: write the list yourself from your own knowledge. Never write or run
code that generates entries. Read only this prompt and `{OUT}`. Append to
`{OUT}` with a quoted heredoc (`cat >> {OUT} <<'EOF'`) every ~50 lines. When
done, print the count per category.

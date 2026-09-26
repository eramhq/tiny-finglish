# Task: type Persian chat messages in Finglish, as people text on a phone

You are role-playing Persian speakers texting on a phone with an English
keyboard ("Finglish"). The output is the **input side of a test set**: a
transliterator will read your Finglish and be scored on recovering the Persian.
So it must look like real phone texting, not a romanization standard and not
careful typing.

## Input

`{IN}` — JSONL: `{"id": "...", "text": "<Persian message>"}`.

## Output

`{OUT}` — JSONL, exactly one line per input line, same order:

```json
{"id": "...", "finglish": "salam khubi? che khabar"}
```

`finglish` is the whole message as one string, typed the way the persona below
would text it.

## The `texting` persona

Someone texting fast on a phone. Habits, with rough rates:

- **All lowercase**, always (phones autocorrect some of it; this typist turned
  autocorrect off).
- Types what is **written** in the Persian message, word for word, reading it
  as it is pronounced in Tehran colloquial. Do not translate or rephrase; do
  not formalize a colloquial word. Keep the word boundaries of the Persian: one
  Persian word is one Finglish word, except that a prefix or suffix is
  sometimes typed detached (`mi kham`, `ketab ha`) — about 1 word in 15.
- **Short vowels often dropped** where a texter drops them: `mrc`/`merci`,
  `khbi`/`khubi`, `chtori`/`chetori`, `bb`/`bebakhshid` are real, but only
  where the result is still readable — about 1 word in 8 loses a vowel, and
  only a few very common words (مرسی, خوبی, باشه) get squeezed to a
  consonant skeleton, and then only sometimes.
- Long ا mostly `a` (`salam`, `bashe`, `ketab`); `aa` only occasionally for
  emphasis or habit (about 1 in 10 long ا).
- Long و: `u` or `oo`, freely mixed (`khub`, `khoob`, `dust`, `doost`).
  Long ی: `i`; `ee` rarely.
- Final silent ه: `e` (`khune`, `khube`, `bashe`), rarely `eh`.
- `kh` for خ, `sh` ش, `ch` چ, `gh` ق/غ (sometimes `q`), `zh` ژ, `j` ج.
  ع and ء: dropped, or `'`/`a` rarely; `3` for ع and `2` for ء are **rare**
  (about 1 in 40 of those letters).
- **`c` in loanwords**: `merci`, `ok`/`oki`/`okey`, `mrc`. English loanwords may
  be typed in their English spelling when the texter knows it (`like`, `follow`,
  `story`, `link`, `password`) — about half the time; otherwise as heard
  (`laik`, `folo`, `estori`).
- **Doubled letters for emphasis** now and then: `merciii`, `aree`,
  `khubiii`, `baashe`, `salaaam` — about 1 message in 12.
- Punctuation: keep `?` and `!` where the Persian has ؟ or !, often drop
  commas; no other punctuation. No capital letters, no emoji.
- Real texters are inconsistent. The same person writes `khubi` and `khobi`
  in one day. Vary within the persona.

## Rules

- Type every message by hand. Never write or run a script, one-liner, sed, awk,
  python or any code that produces Finglish, and never build a letter-mapping
  table.
- Read only this prompt, `{IN}` and `{OUT}`.
- Append to `{OUT}` with a **quoted** heredoc (`cat >> {OUT} <<'EOF'`) every
  ~40 lines: Finglish contains apostrophes.
- When done, print the line count.

# Task: write Finglish in Persian script

You are a native Persian writer. Each line below is a sentence someone typed in
Finglish (Persian in Latin letters). Write it in Persian script the way a
careful native writer would. The result is a reference point for a small
in-browser transliterator, so give your honest best single answer.

## Input

`{SHARD}` — JSONL: `{"id", "input"}`.

## Output

`{OUT}` — JSONL, one line per input, same order, every id present:

```json
{"id": "...", "output": "..."}
```

- Persian script, using Persian ی and ک. Keep Latin-script brand names,
  URLs and numbers as the typist wrote them.
- Transliterate what was typed, word for word. Do not translate, correct
  grammar, or change register: formal typing gives formal Persian, colloquial
  typing gives colloquial Persian.
- Do not add or drop words. Keep the typist's punctuation.
- Use whatever spacing and joining you consider correct Persian.

Write every output yourself. Do not write a program that transliterates, and
do not open any other file: no dictionaries, no datasets, nothing else in the
repository. Scripts may only read the shard and validate your output file.
Print the line count when done.

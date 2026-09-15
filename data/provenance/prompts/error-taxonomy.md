# Task: classify transliteration errors into a fixed taxonomy

A Finglish (Persian typed in Latin letters) to Persian-script transliterator
was run on real human typing. For each item, a word alignment found a run
where its output differs from the reference. Classify **why**.

## Input

`{SHARD}` — JSONL: `{"key", "id", "input", "reference", "hypothesis", "refSpan", "hypSpan"}`.
`input` is the typed Finglish sentence, `reference` the Persian sentence,
`hypothesis` the system output; `refSpan`/`hypSpan` the differing run (either
may be `""`).

## Categories — pick the single best one

| category | use when |
|---|---|
| `homophone` | right word except a homophone letter: س/ص/ث, ز/ذ/ض/ظ, ت/ط, ق/غ, ه/ح (e.g. حیاط for حیات) |
| `ayn` | ع or ء/ئ/أ missing, extra or misplaced (اید for عید, سال for سؤال) |
| `long-vowel` | ا, و or ی missing or extra inside the word (بار for بر, سل for سال) |
| `initial-vowel` | the word-initial vowel carrier is wrong: ا/آ/ای/او/ع at the start |
| `doubled-ye` | two ی where one belongs, or ی/یی confusion |
| `khaa` | the silent و of خوا/خوی missing or extra |
| `ezafe-clitic` | an ezafe, possessive or object clitic, plural or verb ending attached wrongly or rendered as a word (و for a typed `e`) |
| `register` | the typing and the reference are different registers or wordings of the same word, and the output follows the typing (typed `agar`, reference اگه) |
| `joining` | same letters, different spacing: joined vs separated |
| `english` | the output left a Finglish word in Latin letters, or converted an English word the reference keeps |
| `wrong-word` | the output is a different real word or non-word that no rule above explains (e.g. شهر for شوهر where the typing was ambiguous) |
| `input-typo` | the typist misspelled or misheard; the output is a reasonable reading of what was typed |
| `misaligned` | the reference run does not correspond to what was typed at that point |

Judge by reading; do not write code that decides categories. Scripts only to
read the shard and validate output.

## Output

`{OUT}`, JSONL, one line per item, every key present:

```json
{"key": "...", "category": "...", "note": "<= 8 words"}
```

Print category counts when done.

# Chat sets — AI-typed chat Finglish

Users mostly type Finglish in chat, and nothing measured chat before this:
gold and dev are read-aloud sentences, and under 5% of them look like texting.
This directory holds the chat test set and the chat lines the v8 typing round
trained on.

**Every number scored on `chat-dev` or `chat-test` is AI-typed.** An LLM wrote
the Persian and an LLM typed the Finglish. LLM typing converts 10–17 points
easier than human typing of the same sentences (`docs/llm-work.md` §5), so
absolute chat numbers are flattering. Read them as differences between
engines or settings, never as "how well it handles chat". Each row carries
`typedBy: "llm"` so no report can forget this.

| file | rows | what it is |
|---|---:|---|
| `chat-dev.jsonl` | 200 | the chat tuning surface: `run-fixtures --chat`, the `chat-dev` column in `sweep.ts` |
| `chat-test.jsonl` | 100 | scored once, at the end, like gold: `run-fixtures --chat-test`. Never tune on it |
| `chat-lines.jsonl` | 1,505 | training text: Persian chat lines typed by luna — the chat lines (shards 143–149, in v8) and the copula lines (shards 150–152, in v8b, not shipped) |
| `chat-words.txt` | 116 | the chat markers (and `!` written-register markers) behind `build_distill --targeted-predicate chat-word` |

Rebuild: `python -m tiny_finglish_training.build_chat --select | --assemble | --lines`.
Hashes, review tallies and prompt hashes are in `data/provenance/chat.json`.

## How the test set was made

1. **Written.** Two Claude subagents wrote 384 messages across 12 scenes
   (family, work, a trip, shopping, university, football, food, health, a
   couple, tech help, small talk, occasions) with
   `data/provenance/prompts/chat-test-write.md`. The training lines came from a
   different prompt and different topics.
2. **Reviewed by two families.** A Claude subagent and Codex GPT-5.6 luna each
   judged every message for natural, correctly spelled colloquial Persian
   (`chat-review.md`). 376 were accepted by both; luna rejected 8 that Claude
   accepted (هیجده for هجده, پسوورد, خونم for خونه‌م, and five phrasings).
3. **Selected and split by hash.** The 300 lowest by the hash of their words,
   then every third to `chat-test`.
4. **Typed by a different family and persona than the training data.** Claude
   subagents typed with the `texting` persona (`chat-typing.md`): all
   lowercase, dropped vowels (`mrc`, `bgo`), `c` in loanwords (`merci`),
   English spellings of loanwords about half the time (`like`, `backup`),
   doubled letters for emphasis (`merciii`). The training data is typed by luna
   with the `everyday`/`careful` personas, so a model cannot pass this set by
   having learned its typist.

## Reference convention

`expected` follows the gold convention: **no ZWNJ** (میخوام, نمیدونم). A ZWNJ
spelling, and any other equally correct spelling of the same words (آره/اره),
is in `alternatives`. The headline is strict word accuracy against
`expected`; the report's `accepted spellings` tier scores against the closest
of `expected` and `alternatives`, and that tier is the chat-dev column in
`sweep.ts`.

## Leakage

`chat-dev.jsonl` and `chat-test.jsonl` are in `EVALUATION_FILES`
(`build_frequency.py`), so every corpus builder excludes a training sentence
whose words are a chat message (`leak_key`, punctuation and ZWNJ folded), and
the chat draws also drop a sentence sharing four words running with one
(`load_ngrams`). 18 of the 1,019 training lines were dropped that way.
Fixtures for a chat phenomenon use different messages: `chat-001` was `kojaei`
until it turned out to be a chat-dev message word for word.

## Limits

* AI-typed, as above. The typist is also more consistent than a human.
* LLM-written Persian: natural and reviewed, but a model's idea of chat. No
  private chat logs were collected.
* Small: 200 dev messages, 845 reference words. Differences under a point are noise.

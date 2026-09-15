# Dev set — the tuning surface for real human Finglish

`dev.jsonl` is **304 rows of real, human-typed Finglish**, disjoint from gold,
built from the pairs the gold build threw away. Tune here; report gold.

| | |
|---|---|
| Source | the gold source, [mmahdibarghi/finglish-dataset](https://github.com/mmahdibarghi/finglish-dataset) (**MIT**; Persian side Common Voice, **CC0**) |
| Candidates | the 863 pairs `build_gold.py` drops, minus 134 whose Persian sentence is also a gold sentence = **729** |
| Labels | aligned 299, trimmable 6, misaligned 424 → **304 kept** (one more fell under the two-word minimum) |
| Rebuild | `python -m tiny_finglish_training.build_dev` (applies `repairs.jsonl`; see its docstring for the full LLM pass) |

## Two references per row

* `expected` — the Common Voice sentence, trimmed to the aligned span.
* `faithful` — that sentence minimally edited to what was *typed*: typed
  `midaanad` over a colloquial `میدونه` gives `میداند`. No transliterator can
  recover the colloquial form from formal typing, so a number against
  `expected` alone mixes accuracy with register. `node scripts/run-fixtures.ts
  --dev` reports both.
* `source` — the untrimmed sentence, read only by the corpus builders'
  leakage guard (`load_gold_keys`), which excludes dev sentences from the
  frequency and bigram tables exactly as it excludes gold.

## How the labels were made

LLM labour, recorded rather than trusted. Each candidate went, independently,
to a Claude subagent and to Codex GPT-5.6 luna (xhigh), which saw only the two
sides of the row — never an engine's output — and followed
`data/provenance/prompts/dev-repair.md`. They returned identical labels on 593
rows. The other 136 went to a third, blind adjudicator, which saw the two
proposals as A and B in random order; the lead session read 22 of its rows.
Hashes, verdict tables and the adjudicator's choices are in
`data/provenance/dev.json`.

One finding worth keeping: where the two families disagreed about `faithful`,
the blind adjudicator chose the Claude proposal 123 times and luna's 3 times.
Luna tended to keep the colloquial reference where the typing was formal.

## Limits

* **The same one annotator as gold**, and the rows gold rejected — on average
  longer, and more often carrying a detached ezafe (`sal e do hezar`).
* `faithful` is an LLM edit. It is the right target for "did we transliterate
  what was typed", and it is a secondary number for that reason.
* Small: 3,463 reference words. Differences under half a point between
  two configurations are noise; tune on flat regions, not maxima.

# Gold set — untouched

`gold.jsonl` is the honest evaluation set: **1,906 pairs of real, human-written
Finglish** with their Persian originals.

Two rules govern it:

1. **Nothing here is used for tuning.** Not thresholds, not the rule table, not
   the English word list, not hyperparameters. Report it, do not optimize
   against it.
2. **Failures do not silently migrate.** When a gold case fails, a *different*
   case exercising the same phenomenon goes in `data/fixtures/fixtures.jsonl`.
   Moving the gold case itself into the dev set is how a project quietly stops
   measuring anything.

## Provenance

| | |
|---|---|
| Source | [mmahdibarghi/finglish-dataset](https://github.com/mmahdibarghi/finglish-dataset) |
| Licence | **MIT** |
| Persian side | Mozilla Common Voice Persian (**CC0**) |
| Finglish side | written by a human annotator for a text-to-speech project |
| Raw rows | 3,846 → 2,769 unique pairs → **1,906 kept** |

Rebuild with `python -m tiny_finglish_training.build_gold`; hashes and drop
counts land in `data/provenance/gold.json`.

**This is real typing**, which is the whole point. 17 of 18 colloquial markers
probed are present — `midouni`, `misheh`, `vaseh`, `nemidoonam`, `bashe`. It
carries the register and the inconsistency that synthetic data cannot fake.

It is also what corrected the corpus generator: measured over its 21,874 word
tokens, `x` for خ occurs in **0.1%** of cases and `q` for ق in **3.9%**, where
the generator had been emitting both at 30%. See `latinWeights` in
`src/rules.ts`.

## Limits, which belong in any citation of a number from this file

* **One annotator, not a panel.** Per-writer spelling habits are baked in. A
  real panel would show more variance, and probably lower scores.
* **Read-aloud register, not chat.** It was written for TTS, so it is closer to
  spoken-written Persian than to Telegram.
* **~30% of source rows were dropped as misaligned.** The filter keeps pairs
  whose Persian and Finglish word counts differ by at most one. That is
  conservative and will have discarded some valid long pairs.

To make this fully load-bearing, follow the Dakshina protocol: 2,000–3,000
Persian sentences across formal and colloquial register, each typed by
*several* native annotators in their own natural Finglish, keeping every
romanization as a legitimate alternative.

## `authored.jsonl`

The previous gold set — 71 pairs written by the same author as the rule table,
which is precisely why it was not trustworthy: it tested Finglish the rules
already handled. Kept for continuity and as a hand-curated smoke test. **It is
not the headline metric.** Run it with `--gold-set authored`.

## Realistic target

Prior art on the closest measured analogue (romanized → Perso-Arabic Urdu, real
human romanization) reaches **87.8% word accuracy** with a contextual language
model and **66–76%** without one. Persian ZWNJ placement has a human ceiling
around **83%**.

Report **word accuracy** as the headline, not sentence exact-match: at ~8 words
per sentence the latter collapses toward zero and stops discriminating.

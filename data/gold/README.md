# Gold set — untouched

`gold.jsonl` is the honest evaluation set: **1,835 pairs of real, human-written
Finglish** with their Persian originals. A further 71 pairs sit in
`gold-misaligned.jsonl`, quarantined but not deleted — see below.

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
| Raw rows | 3,846 → 2,769 unique pairs → 1,906 aligned → **1,835 kept** |

Rebuild in two stages — `python -m tiny_finglish_training.build_gold`, then
`node scripts/split-gold.ts --write`. Hashes and drop counts for both land in
`data/provenance/gold.json`. Running the first alone restores the 71
quarantined rows, so run both.

**This is real typing**, which is the whole point. 17 of 18 colloquial markers
probed are present — `midouni`, `misheh`, `vaseh`, `nemidoonam`, `bashe`. It
carries the register and the inconsistency that synthetic data cannot fake.

It is also what corrected the corpus generator: measured over the 21,874 word
tokens of the 1,906-row set as first built, `x` for خ occurs in **0.1%** of
cases and `q` for ق in **3.9%**, where the generator had been emitting both at
30%. See `latinWeights` in `src/rules.ts`. Those weights were fitted before the
quarantine below and have not been refitted; the `x` share is unchanged on the
1,835 rows that remain.

## `gold-misaligned.jsonl` — 71 rows whose two sides are different sentences

The word-count filter above drops 826 rows whose Persian and Finglish sides
disagree in length by more than one word. It cannot see a row where the counts
happen to agree and the *content* does not:

| | |
|---|---|
| input | `4 you have to call` |
| expected | `چهارم، توزیع مجدد ثروت` |

71 of the 1,906 aligned rows (3.7%) are like this. They score 0% for every
engine, at every beam width, and always will. Leaving them in understates every
number in this repository by about 1.5 points while measuring nothing.

They are **moved, not deleted**: they are evidence about how the source dataset
was collected, and a provenance record that silently discarded them would be
worth less. `scripts/split-gold.ts` selects them — character error rate above
0.9 against the strongest shipped configuration, under the same ZWNJ and
punctuation fold the headline metric applies — and records the rule, the
engine and both file hashes in `data/provenance/gold.json`. It is idempotent
and re-derives the split from both files, so a future engine that rescues a row
returns it to the set rather than leaving it stranded.

## Limits, which belong in any citation of a number from this file

* **One annotator, not a panel.** Per-writer spelling habits are baked in. A
  real panel would show more variance, and probably lower scores.
* **Read-aloud register, not chat.** It was written for TTS, so it is closer to
  spoken-written Persian than to Telegram.
* **~30% of source rows were dropped as misaligned.** The filter keeps pairs
  whose Persian and Finglish word counts differ by at most one. That is
  conservative and will have discarded some valid long pairs.
* **The Persian side contains no ZWNJ at all.** Zero of 1,835 references, where
  ordinary Persian uses one in about 23% of word types — `میکنم`, never
  `می‌کنم`. So this file cannot measure ZWNJ placement (the metric has no
  denominator here; only `data/fixtures/` does), and it actively penalizes an
  engine that places one correctly: the headline metric folds ZWNJ to a space,
  so a correct `می‌کنم` splits into two words against a reference that spells it
  solid. Measured, that handicap is **3.1 points** for the learned model, which
  emits 816 of them, and zero for the rule baseline, which structurally cannot
  emit any. Subtract it before reading the model/rules gap as an accuracy gap.
* **The two sides are often in different registers, and this caps the score.**
  The annotator frequently typed a *formal* Finglish rendering of a
  *colloquial* Persian original. Input `aan ham agar biaayand`, reference
  `اونم اگه بیان`; a faithful transliteration is `آن هم اگر بیایند`, and it
  scores 0%. Probing 20 formal/colloquial pairs — `agar`/`اگه`, `raa`/`رو`,
  `aan`/`اون`, `shavad`/`شه` — finds **99 rows (5.4%)**, scoring **44.4%**
  against **62.2%** on the rest. Twenty probes is a floor, not a census: the
  real bucket is larger, and no transliterator can reach it, because the
  information needed to choose the colloquial form is not in the input. Any
  claim about the remaining headroom on this file should subtract it.

  This is a property of the dataset, not a bug to fix. The product question it
  raises — whether the converter should offer a colloquial output mode — is a
  separate one, and is not in scope here.

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

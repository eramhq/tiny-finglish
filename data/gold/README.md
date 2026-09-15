# Gold set — untouched

`gold.jsonl` is the honest evaluation set. Two rules govern it:

1. **Nothing here is used for tuning.** Not thresholds, not the rule table, not
   the English word list, not hyperparameters. Report it, do not optimize
   against it.
2. **Failures do not silently migrate.** When a gold case fails, it goes in the
   failure bank (`data/fixtures/failures.jsonl`) and a *different* case exercising
   the same phenomenon goes in `data/fixtures/fixtures.jsonl`. Moving the gold
   case itself into the dev set is how a project quietly stops measuring anything.

## Provenance and its limits

These pairs are **author-written**, not collected from native speakers typing
naturally. That is a real limitation and it cuts in a specific direction: an
author who knows the rule table writes Finglish that the rule table handles.
Real Finglish is more inconsistent than this.

The plan's own risk register calls this out as "synthetic-data bias", and the
measured literature agrees — a comparable system evaluated on machine-generated
romanization scored 81–83% and its authors flagged that as an optimistic ceiling
rather than a field expectation.

**To make this set actually load-bearing**, follow the Dakshina protocol:
sample 2,000–3,000 Persian sentences across formal and colloquial register, have
several native annotators type each in their own natural Finglish, and keep
every romanization they produce as a legitimate alternative. Until that happens,
treat numbers from this file as directional.

## Realistic target

Prior art on the closest measured analogue (romanized → Perso-Arabic Urdu, with
real human romanization) reaches **87.8% word accuracy** with a contextual
language model, and **66–76%** without one. Persian ZWNJ placement has a human
ceiling around **83%**.

**85–92% word accuracy** is the honest target band, mapping to roughly
**40–60% sentence accuracy**. Anything above 95% offline in this budget should
be assumed to be leakage until proven otherwise.

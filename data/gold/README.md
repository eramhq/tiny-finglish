# Gold set — untouched

`gold.jsonl` is the honest evaluation set: **1,669 pairs of real, human-written
Finglish** with their Persian originals. A further 237 pairs sit in
`gold-misaligned.jsonl`, quarantined but not deleted — see below.

**Tuning happens on `data/dev/`, not here.** Since September 2026 there is a
second real set, built from the rows the gold build rejected and disjoint from
this one, so there is somewhere legitimate to tune (`data/dev/README.md`).

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
| Raw rows | 3,846 → 2,769 unique pairs → 1,906 aligned → **1,669 kept** |

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
quarantine below and have not been refitted. The `x` share was unchanged on the
1,835 rows left after the first, CER-only quarantine. The rule engine's channel
no longer depends on them alone: `src/channel-fitted.ts` is re-estimated from
LLM-typed Finglish, never from this file.

## `gold-misaligned.jsonl` — 237 rows whose two sides are different sentences

The word-count filter above drops 826 rows whose Persian and Finglish sides
disagree in length by more than one word. It cannot see a row where the counts
happen to agree and the *content* does not:

| | |
|---|---|
| input | `4 you have to call` |
| expected | `چهارم، توزیع مجدد ثروت` |

237 of the 1,906 aligned rows (12.4%) are like this. They score 0% for every
engine, at every beam width, and always will.

They were found in two passes, and every row in the file carries a `reason`:

* **`cer` — 77 rows.** Character error rate above 0.9 against the strongest
  shipped rule configuration. This catches only rows that no engine output
  resembles.
* **`audit` — 160 more rows.** Every one of the 1,906 rows went, independently,
  to a Claude subagent and to Codex GPT-5.6 luna. Each saw only the two sides,
  never an engine's output, and labelled the row aligned, partial or
  misaligned (`data/provenance/prompts/gold-audit.md`). A row moves only when
  **both** say misaligned. They agreed on 1,887 of 1,906 rows. The lead session
  read all 14 disagreements and moved none. All 77 CER rows are also inside the
  audit's 237, so the split does not depend on which engine runs the CER rule.
  Verdicts are in `audit.jsonl`, keyed to each row's content hash.

Quarantining the audit's 160 rows moved rules + frequency from 62.3% to 66.9%
and the model from 51.2% to 55.1%, with no code change. That is a metric
correction, and it is reported as one wherever those numbers appear.

They are **moved, not deleted**: they are evidence about how the source dataset
was collected, and a provenance record that silently discarded them would be
worth less. `scripts/split-gold.ts` selects them — character error rate above
0.9 against the strongest shipped configuration, under the same ZWNJ and
punctuation fold the headline metric applies — and records the rule, the
engine and both file hashes in `data/provenance/gold.json`. It is idempotent
and re-derives the split from both files, so a future engine that rescues a row
returns it to the set rather than leaving it stranded.

## `faithful` — a second reference, edited to what was typed

Every row carries `faithful` next to `expected`: the same sentence minimally
edited so it is what the typist actually typed. Input `aan ham agar biaayand`,
reference `اونم اگه بیان`: `expected` keeps it, `faithful` has `آن هم اگر
بیایند`. It exists because a score against `expected` alone mixes accuracy with
register (see the register limit below). 513 of the 1,669 rows (31%) differ
from `expected`; on dev about a quarter do.

**How it was made (2026-09-28).** The same way as dev's, so the two are
comparable:

* **Rules.** `data/provenance/prompts/gold-faithful.md` holds the `faithful`
  rules of the dev repair prompt, word for word: change a word only when the
  typing clearly says another form, insert or delete typed-only words, keep
  the reference word when the typing is a misspelling, keep the reference's
  spelling and joining, never add a ZWNJ, digits or words as typed. There is
  no verdict or span step, because every row here already passed the alignment
  audit.
* **Two families.** Each row went to a Claude subagent (Opus 5.5, 8 shards)
  and to Codex gpt-6-luna at xhigh (4 herdr panes, 2 shards each). Both saw
  `input` and `expected` only, never an engine's output. **1,350 rows came back
  identical** after normalization; 1,076 of those are unchanged from
  `expected`.
* **Blind adjudication.** The 319 disagreements went to four Claude subagents
  that saw the two proposals as A and B in an order randomised per row
  (prompt `gold-faithful-adjudicate.md`). They chose the Claude text 301
  times and luna's 16, and wrote their own twice. The result is
  `faithful-adjudications.jsonl`. 81 of the disagreements are spacing only
  (آقاهم / آقا هم), which the orthographic tier forgives anyway; in 96 luna
  left the reference unchanged where Claude edited it, in 49 the reverse.
* **Lead spot check.** 30 random agreed rows were read and all 30 accepted. Of
  20 adjudicated rows (every luna or edited choice, plus two), 18 were
  accepted and 2 are debatable, left as adjudicated: gold-0637 keeps محیط over
  typed `monitor`, and gold-0713 drops the ezafe of دنباله for typed `donbal`.

The labels live in `faithful.jsonl`, keyed by the row's content hash like the
audit, because `build_gold.py` rewrites `gold.jsonl` and would drop the field.
`node scripts/split-gold.ts` attaches them and stops if any row's hash no longer
matches. Rebuild with `python -m tiny_finglish_training.gold_faithful --merge
<run dir>`; the record is `faithfulPass` in `data/provenance/gold.json`.

**Its limits.** It is an LLM edit, checked but not a human's. The adjudicator
is a Claude model and chose the Claude text 19 times in 20. On dev it did the
same (123 to 3). That may be a better writer, or a judge favouring its own
family; a blind Claude judge cannot tell the two apart. Where typing and
reference say different words (`monitor` / محیط), "what was typed" is a call,
not a fact. So the headline stays the number against `expected`, and the one
against `faithful` sits beside it.

**The leak guard does not read it.** `load_gold_keys` excludes corpus sentences
by `expected` (dev: `source`), not `faithful`, for gold and for dev. A
`faithful` sentence that differs from its reference is not excluded from the
frequency or bigram corpora. That is left as is on purpose: changing the guard
would change every future rebuild of the committed tables.

## Limits, which belong in any citation of a number from this file

* **One annotator, not a panel.** Per-writer spelling habits are baked in. A
  real panel would show more variance, and probably lower scores.
* **Read-aloud register, not chat.** It was written for TTS, so it is closer to
  spoken-written Persian than to Telegram.
* **~30% of source rows were dropped as misaligned.** The filter keeps pairs
  whose Persian and Finglish word counts differ by at most one. That is
  conservative and will have discarded some valid long pairs.
* **The Persian side contains no ZWNJ at all.** Zero of 1,669 references, where
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
  The `faithful` reference above now measures it: every shipped setup scores
  about **7.5 points** higher against it (hybrid 82.5% → 90.0%).

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

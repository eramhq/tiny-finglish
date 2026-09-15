# LLMs in the loop — what they did, and how far to trust it

This project ships a transliterator of about 151 KiB. None of it is an LLM.
Frontier LLMs did four jobs *around* it, all offline and all recorded:
measure, label, judge and generate. This page says what each job was, how its
output was checked, and what it found. Every prompt is committed under
`data/provenance/prompts/` and hashed in the provenance files.

**Workers.** Two model families, so a judgment is never one model's opinion:

* Claude Opus 5 as in-session subagents;
* Codex GPT-5.6 luna at `model_reasoning_effort=xhigh`, run as interactive
  agents in herdr panes.

Judges saw only what their job needed. The gold audit and the dev repair saw
the two sides of a row and never an engine's output. Every job's prompt forbids
writing code that produces the answer, so each label is a read, not a
heuristic.

---

## 1. Gold alignment audit — both families, 1,906 rows

The CER quarantine in `scripts/split-gold.ts` could only catch misaligned rows
that no engine output resembled. Each row was labelled independently:

| claude / luna | rows |
|---|---:|
| aligned / aligned | 1,650 |
| misaligned / misaligned | **237** |
| aligned / partial | 11 |
| partial / partial | 5 |
| aligned / misaligned | 3 |

A row is quarantined only when both families say misaligned. The lead session
read all 14 disagreements and none moved. Every row the CER rule catches is
inside the 237. Gold is now 1,669 rows.

The effect is a **metric correction, not accuracy**. The shipped engines
measured 62.3% and 51.2% before it, and 66.9% and 55.1% on the same code after.

## 2. Dev set repair — both families plus a blind adjudicator, 729 rows

The 863 pairs the gold build dropped, minus 134 that repeat a gold sentence.
Each family returned a verdict (aligned, trimmable or misaligned), aligned word
spans, and a `faithful` reference edited to what was typed.

* They returned **identical labels on 593 rows**, and verdicts agreed on all
  but 5.
* The 136 others went to a third Claude pass that saw the two proposals as A
  and B in random order. The lead session read 22 of its rows.
* **The blind adjudicator chose Claude's text 123 times and luna's 3 times**,
  and edited 11. Luna tended to keep a colloquial reference where the typing
  was formal. It also overruled all five of luna's misaligned verdicts.

Result: 304 rows, 3,463 words — `data/dev/`.

## 3. Error taxonomy — Claude, 1,545 error runs

Every word run charged on dev, for the rule engine and the model, went into one
of 13 categories. The lead session read a 10% sample and agreed with about 95%
of the labels. The table and what it changed are in `docs/error-taxonomy.md`.

## 4. The judged-acceptable tier — both families, calibrated first

A charged run is refunded only when **both** families accept it as an
orthographic variant or a faithful rendering of the typing (prompt
`judge-span.md`). Before any tier number was trusted, the lead session labelled
100 dev runs by hand, blind to the judges. The judges then labelled the same
100 (`data/results/judge-calibration.jsonl`, `node scripts/judge.ts
--calibrate`):

| judge | agreement with hand labels | κ | false accepts | false rejects |
|---|---:|---:|---:|---:|
| Claude | 96% | 0.92 | 1 | 3 |
| luna | 93% | 0.86 | 2 | 5 |
| **both must accept** | **95%** | **0.90** | **0** | 5 |

Multilingual LLM judges are reported at κ≈0.3 against humans. The difference
here is a narrow, closed rubric and two families. **One caveat is not
optional:** the hand labels were written by the lead session, which is also a
Claude model. So Claude's 0.92 is inflated by shared habits, and luna's 0.86 is
the more independent figure.

The both-accept rule made no false accepts and 5 false rejects. It is
conservative, which is the right direction for a number printed next to a
headline.

**The tier, measured.** Both families judged every charged run for the rules
and hybrid engines on all of dev (896 runs) and on a fixed quarter of gold,
every fourth row (418 rows, 692 runs). Nothing was left unjudged. The families
disagreed on 7% of runs, and a disagreement refunds nothing
(`data/results/judgments.jsonl`):

| engine | dev strict | dev judged | gold sample strict | gold sample judged |
|---|---:|---:|---:|---:|
| rules + frequency | 58.2% | **79.1%** | 75.0% | **85.6%** |
| hybrid | 57.6% | **81.3%** | 72.0% | **85.8%** |

Read it as: of the 42 points the rule engine loses on dev under the strict
metric, about half are runs two independent judges accept as a legitimate
rendering. Mostly that is spacing, or formal typing converted faithfully
against a colloquial reference. The other half are real errors. The hybrid
loses strict points to ZWNJ but writes more acceptable Persian.

## 5. Does LLM typing look like human typing? — both families

LLM "typists" romanized the dev set's own Persian, so every LLM sentence has a
human sentence for the same words (`scripts/fidelity.ts`). Two findings:

**LLM typing is too clean.** The shipped rule engine converts the LLM typing
at 72–86% against the faithful reference, and the human typing of the same
sentences at 68–69%. That holds for every persona, both families, and both
persona versions. Humans are 10–17 points harder to read than an LLM
pretending to be one.

**Persona cards have to be calibrated, not described.** Version 1's four
caricatures each missed the human badly. `careful-aa` wrote `aa` 38 times per
100 words (human: 18). `casual-a` wrote `u` 7 times (human: 0.3). `ou-eh`
wrote a final `eh` 13 times (human: 1). No mixture of them fit. Version 2
states the human's measured rates in the card, and its habit distance to the
human fell from 0.67 at best to **0.22** (`everyday`) and **0.32**
(`careful`).

## 6. Distillation — LLM-typed Finglish as training data

3,000 HomoRich sentences (CC0), with gold and dev excluded by the shared
leakage guard, were each typed by both calibrated personas: 6,000 variants and
52,486 word pairs (`data/distill/llm-finglish.jsonl.br`). Claude typed 5,400 of
them and luna 600. The channel's forced alignment turned 95.1% of the pairs
into per-character training labels (`scripts/align-pairs.ts`).

Before any arm was trained, reading the synthetic corpus found a generator bug.
`g2p.py` wrote the Persian letters ع ئ ء ؤ into the *Latin* side of 21,008 of
425,590 examples (`aabaعli`), and the model saw each as `<unk>`. It is fixed
and has a regression test. Every arm below uses the fixed corpus.

Same 102k architecture and recipe, int6. Dev scored strict / faithful, then
fixtures:

| training data | dev strict | dev faithful | fixtures |
|---|---:|---:|---:|
| v4 as shipped before (old generator) | 43.7 | 53.1 | 80.4 |
| synthetic only, generator fixed | 44.2 | 53.7 | 80.7 |
| 25% LLM-typed | 54.6 | 65.1 | 87.6 |
| **50% LLM-typed** (shipped) | **55.6** | **66.3** | **88.9** |
| 100% LLM-typed | 52.7 | 63.1 | 84.6 |

**+11.4 dev points from 3,000 LLM-typed sentences**, and the model's gold
score moved from 56.1% to 69.2%. Synthetic and LLM data complement each other.
Synthetic gives vocabulary coverage (100k stems), and LLM typing gives
realistic spelling and real sentence vocabulary. Neither alone matches the mix.

**Learning curve**, pure LLM data, dev strict: a quarter of the pairs 48.6, a
half 50.8, all 52.7. That is about +2 points per doubling, still rising. The
plan's scale-up to ~20k sentences would plausibly put the model level with the
rules. It was not run in this session: at about 100k subagent tokens per 150
sentences, it is the single largest cost item left and deserves a decision
rather than a default.

**The same data fits the channel.** Hard EM over the pairs
(`scripts/fit-channel.ts`) re-estimates every P(Latin | Persian letter,
position). The result is `src/channel-fitted.ts`, 981 bytes Brotli, and it
moves the rule engine +0.8 on dev strict and faithful. The fit exposes LLM bias
too: ا is typed `aa` 55% of the time in the LLM data against 30% measured on
humans. Smoothing toward the table (alpha 20) is what keeps that from
dominating.

## 7. Zero-shot references — how far is the ceiling?

Both families transliterated the gold inputs zero-shot, seeing only the
Finglish (`zero-shot.md`). Claude did all 1,669 rows. To keep luna's budget for
judging, luna did every fourth row, 418 of them. Scored with the same metric
(`data/results/llm-reference.jsonl`, `scripts/compare.ts`):

| subject | all 1,669 rows: strict / ortho | luna's 418 rows: strict / ortho |
|---|---:|---:|
| Claude Opus 5, zero-shot | 77.7 / 84.0 | 78.1 / 84.8 |
| GPT-5.6 luna xhigh, zero-shot | — | 76.7 / 83.0 |
| tiny-finglish rules + frequency | 73.5 / 75.7 | 75.0 / 76.9 |
| tiny-finglish hybrid | 71.4 / 76.3 | 72.0 / 77.4 |

On strict word accuracy, a frontier model is **about 3–4 points** ahead of a
151 KiB in-browser engine on this data, at roughly 20,000 times the compute.
The gap on the orthographic tier is twice that. LLMs space and join Persian the
way the reference does, which the rule engine often cannot: it follows the
typist's spacing, and its model half emits ZWNJ where the reference writes
none. No LLM gets near the 85–92% band either. Formal typing over colloquial
references caps them as it caps everything else.

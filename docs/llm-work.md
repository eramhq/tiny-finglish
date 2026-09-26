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

10,049 HomoRich sentences (CC0), with gold and dev excluded by the shared
leakage guard, each typed by both calibrated personas: 20,144 variants and
176,671 word pairs (`data/distill/llm-finglish.jsonl.br`). Claude typed 5,400
variants and luna 14,744. The channel's forced alignment turned 93.4% of the
pairs into per-character training labels (`scripts/align-pairs.ts`), 164,990
examples against 49,890 at 3,000 sentences.

The first 3,000 came from seed 20260915; a second sample with seed 20260916
drew 7,050 more from the same 413,734-sentence pool, with the 54 ids that
collided dropped before anything was typed. Ten luna agents typed them in
parallel in herdr panes, about 100 sentences a minute, and the whole scale-up
did not move the weekly rate limit off 85% — the binding constraints were
wall-clock and the machine's RAM, not the model quota.

Two things had to be fixed mid-run, both worth recording because both would
have quietly degraded the corpus:

**Apostrophes broke shell quoting.** Workers appended their output with the
Finglish as shell arguments, and `sa'at` ends the quoting early. 2.2% of lines
came out malformed — mostly one word merged into its neighbour. The merge
validator already refuses such rows, so nothing bad entered the corpus, but the
yield was the cost. Workers were also forbidden to read their own output file,
so one could not repair itself and stopped to ask instead. Both rules were
wrong: the prompt now requires a quoted heredoc and explicitly allows a worker
to read and repair its own output. The 296 affected sentences had every line
removed and were re-typed in shards 67-68, so none is counted twice.

**luna missed rates the persona card states.** Its `everyday` persona wrote
`aa` 39 times per 100 words where the card says ~15 and the human writes 18.4,
and detached ~10 affixes where the human detaches 10.8 but Claude detaches 16.3.
Since the new data is 70% of the corpus, that would have reshaped the habit mix.
The worker prompt restated the rates; the calibrated card itself was not edited.
Measured over all 7,049 new sentences, luna/everyday landed at `aa` 21.8 and
14.1 detached, habit L1 **0.34** — closer to the human than claude/everyday's
0.35. The scale-up did not dilute habit fidelity.

Same 110k architecture and recipe, int6. Dev scored strict / faithful, then
fixtures:

| training data | dev strict | dev faithful | fixtures |
|---|---:|---:|---:|
| 50% LLM, 3,000 sentences (previous ship) | 55.6 | 66.3 | 89.0 |
| 25% LLM, 10,049 sentences | 55.0 | 65.4 | 85.7 |
| **50% LLM, 10,049 sentences** (shipped) | **56.2** | **67.1** | **92.2** |
| 100% LLM, 10,049 sentences | 56.0 | 66.4 | 90.3 |

50% still wins on every tier, so the synthetic half is still contributing. On
gold, scored once at the end, the model moved 69.2 → **70.3** strict and
73.9 → **75.2** orthographic, and ZWNJ placement on fixtures went 41% → **56.3%**.

**Learning curve**, pure LLM data, dev strict, by sentences typed:

| sentences | 750 | 1,500 | 3,000 | 2,512 | 5,024 | 10,049 |
|---|---:|---:|---:|---:|---:|---:|
| dev strict | 48.6 | 50.8 | 52.7 | 52.2 | 51.5 | **56.0** |

The first three points are the earlier claude-heavy corpus; the last three are
nested subsets of the merged one. **The curve has not flattened**: 3,000 →
10,049 is +3.3 points over 1.74 doublings, about +1.9 per doubling, the same
rate as before. But it is noisier than the old one made it look — 52.2 → 51.5 →
56.0 is not monotonic, so read about ±1 point into any single step. Each arm
picks its checkpoint on its own mixed dev and the label vocabularies differ
(103,713 / 103,973 / 104,688 parameters).

**Why the mix gained only +0.6 while pure LLM gained +3.3.** `mix()` upsamples
the LLM half by repetition until it equals the synthetic count, so the training
set is 857k examples either way. Tripling the sentences cut repetition from
~8.6× to ~2.6×: it bought diversity at constant exposure, while the pure-LLM
arms grew in actual size. Anyone reading the mix arm alone would wrongly
conclude the data stopped paying.

**Where that leaves ~20,000.** The per-doubling rate is intact and above the
+1 stop rule, so more sentences should still buy accuracy on the pure-LLM
curve. The honest caveat is that the shipped configuration is the mix, and the
mix is now rate-limited by its own upsampling rather than by how much LLM data
exists. Scaling the data again without revisiting how the two corpora are
combined would likely buy another fraction of a point, not another 3.

**The same data fits the channel.** Hard EM over the pairs
(`scripts/fit-channel.ts`) re-estimates every P(Latin | Persian letter,
position). Re-fitting from 10,049 sentences moves the rule engine 58.2 → 58.3
dev strict, 69.2 → 69.4 faithful and 83.4 → 83.8 fixtures, so it was kept; it
costs the hybrid 0.3 strict and leaves the model untouched. The fit exposes LLM
bias too: ا is typed `aa` far more often in LLM data than humans type it.
Smoothing toward the table (alpha 20) is what keeps that from dominating.

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

## 8. Chat — a test set, a supplement, and a typing round

Nothing measured chat, which is what users mostly type. This round used both
families for three jobs (`data/chat/README.md`, `data/provenance/chat.json`).

**Writing and review.** Claude subagents wrote 1,040 training chat lines over
eight topics (`chat-write.md`) and, separately, 384 test messages over twelve
scenes (`chat-test-write.md`). Every line then went to a second Claude
subagent and to luna with the same review prompt (`chat-review.md`), and was
kept only if both accepted it:

| | both accept | Claude only | luna only | neither |
|---|---:|---:|---:|---:|
| training lines | 1,019 (+11 duplicates) | 7 | 2 | 1 |
| test messages | 376 | 8 | 0 | 0 |

Acceptance near 99% is plausible for a model reviewing its own family's
colloquial Persian, and it is the weak point of this set: luna was the only
reviewer that rejected anything much, and several of its rejects are
defensible spellings (خونشون, آلودس). Both-accept is conservative, so the cost
is yield, not quality.

**The test set is typed by a different family and persona than the
training data.** Claude typed it with a `texting` persona (`chat-typing.md`):
lowercase, dropped vowels (`mrc`, `bgo`), foreign spellings of loanwords about
half the time (`backup`, `like`), doubled letters for emphasis. The training
round is luna with the calibrated `everyday`/`careful` personas. A model trained
on luna's habits cannot pass the test set by having learned its typist, and
that is the only protection against the flattery of AI typing this set has.
Its numbers are still AI-typed and still optimistic.

**The typing round.** 1,701 sentences, shards 138-149: 700 HomoRich lines
drawn with the `chat-word` predicate and 1,001 of the reviewed chat lines,
typed by five luna agents in about two hours. Two notes were added to the worker
message for this round only. Loanwords may take their foreign spelling, the one
place the cards allow `c` (the typed round has `merci` 16 times and `mersi` 12).
And short messages keep one string per Persian word.

Short sentences made the old problem worse: the first finished shards had
16-26% of persona pairs byte-identical, against a 15% round limit, and most of
those pairs contained a long ا, so `careful` was typing it the `everyday` way.
Workers were told to check each finished file and retype the `careful` line of
identical pairs that contain an ا. That took the round to 9.4%. Round
aggregate: everyday `aa` 20.8 / detached 8.5, careful 29.6 / 0.2, 0 of 12
files outside their band. 3,366 of 3,402 lines survived the merge validator.

**v8, two arms, same recipe as v7** (`upsample 0.5`, 12 epochs, int6).
`v8-word` places LLM examples by the synthetic corpus's per-word split;
`v8-sentence` by sentence id (`mix --llm-split sentence`). The per-word split
puts خوبی and چطوره in test, so under it no typed example of them ever trains.
Model tier, dev strict / faithful, fixtures, chat-dev (AI-typed, closest
accepted spelling):

| weights | dev | fixtures | chat-dev |
|---|---:|---:|---:|
| v7 (shipped) | 57.1 / 67.9 | 90.2 | 84.1 |
| v8-word | 56.9 / 67.7 | 92.5 | 86.5 |
| **v8-sentence** | **58.0 / 68.9** | 92.2 | **87.0** |

The sentence split wins, which says the word split was costing more than chat
words: a word held out of training is held out of every sentence it occurs in.
v8-sentence also writes `merci` and `kojaei` on the model tier, which v7 never
did. It failed the round's ship rule on one word: the rule also required
`ketabe` → کتابه on every tier, and the model prefers کتاب 81/19 after the
clause-final tilt, because in its data `ketabe` is far more often the ezafe
(`ketabe man`) than the copula. Re-sweeping `finalHe` for v8 is flat over 2-3
on all three tiers; the model tier reaches کتابه only at 3.5, by 0.03 nats,
where it starts losing fixtures.

**The follow-up, aimed at that word, did not work.** Claude wrote 500 short
chat lines ending in the copula (`chat-copula-write.md`, mostly nouns:
ماشینه، گوشیه، دوستمه); Claude accepted all 500 and luna rejected 7, six of
them for the colloquial رو in place of روی. Three luna agents typed the 489
that cleared the leakage guard (identical pairs 12.5%, 0 of 3 files out of
band). Retrained the same way (v8b, 15,141 sentences), the model moved
`ketabe` from 81/19 to 60/40, still the wrong side, started writing
`daneshjooha` as دانشجوهه, and lost 0.3 dev strict and 0.5 fixtures while
gaining 1.8 on chat-dev. A few hundred targeted lines shift a word-level prior,
but the word-level model cannot see that `ketabe` ends a clause, so it
over-applies the ه instead of learning the position.

**v8-sentence ships, with `ketabe` as a known miss on the model tier**, by the
user's decision: it is better than v7 on every surface this project measures,
and the rules and hybrid tiers write کتابه. Scored once: gold 71.1 → 72.4 on
the model tier and 72.2 → 72.8 hybrid; chat-test (AI-typed) 75.4 → 79.0 and
76.9 → 78.2. The copula lines stay in the corpus artifact for a later round;
v8 was trained on the 14,660 sentences before them.

**v8-eos: give the model the clause end, and change nothing else.** Next, the
position was made visible to the model. `scripts/align-pairs.ts` marks the last word of each
typed line `final` (the artifact's punctuation was stripped at sampling, so a
mid-line comma is lost). A `final` example is encoded with `<eos>` after it
(`data.py`); the id was already in the input vocabulary and never used. The
runtime sends it where `endsClause` holds, only to weights whose header says
`clauseMarker: true`. Training was surgery, tinySarf-style: start from v8's
`best.pt`, freeze everything, train only the `<eos>` embedding row (64 floats)
on the v8b corpus's 54,521 clause-final examples, 12 epochs, no weight decay
(`train.py --surgery-from … --train-only eos-row`). Any word without the
marker then computes exactly what v8 computes. `scripts/verify-surgery.ts`
confirms the export differs from v8's in that one row only, and parity holds
on marked inputs (worst delta 1.8e-5).

On the model's own dev, clause-final words went from 79.6% to 83.3% and nothing
else moved. On the evaluation sets (`scripts/ab.ts`, v8 → v8-eos, model tier,
strict):

| set | b − a | 95% CI | rows b / a |
|---|---:|---|---|
| dev | −0.1 | −0.4 to +0.2 | 6 / 8 |
| fixtures | −1.6 | −3.5 to 0.0 | 3 / 9 |
| chat-dev | +0.1 | −1.1 to +1.3 | 5 / 6 |
| chat-dev, accepted | −0.1 | −0.8 to +0.7 | 3 / 5 |

The hybrid is flat on all three. It fails the round's ship rule in substance,
if not quite in the letter (the fixtures CI touches 0). `ketabe` → کتابه does
flip on the model tier, but the fixture losses are the rule's own failure
mode. `bacheha` → بچهه is دانشجوهه again, and `roosta` → روسته and
`havapeyma` → هواپیمه put a ه on words that end in *a*. A fixture of one word is
clause-final, and so is every word while it is the last one typed. The marker
alone moves `ketabe` from 97/3 to 78/22, and the `finalHe` tilt does the rest.
No tilt separates the good flips from the bad ones: `roosta` flips at about
0.5 nats and `ketabe` needs about 1.25. One row cannot tell the copula from
a word ending in a vowel. It learned "more ه at the end" and applied it
everywhere.

Not shipped. v8 stays, and gold and chat-test were not scored. The plumbing
stays; old weights are unaffected because they lack the header flag. The next
step, if any, is to unfreeze the head as well, and it would be judged on
`ab.ts` alone.

**v9-eos: the marker trained in from scratch.** Same recipe as v8 (12 epochs,
seed 0), on v8's data with the `final` flags (v9-eos) and on v8b's (v9b-eos).
On the words the marker was for, it does what one row could not: `ketabe` →
کتابه at 0.998 while `ketabe man` stays کتاب من, `in mashine` → این ماشینه,
and روستا, بچها, دانشجوها and هواپیما are untouched. It is still worse overall
(`ab.ts`, model tier, strict):

| comparison | dev | chat-dev |
|---|---:|---:|
| v8 → v9-eos | −1.6 (−2.4 to −0.9) | −2.6 (−4.4 to −0.8) |
| v8 → v9b-eos | −1.6 (−2.4 to −0.9) | −2.4 (−4.1 to −0.6) |
| v9-eos, marker off → on | +0.4 (−0.1 to +0.8) | +2.1 (+0.7 to +3.6) |

This is not training noise. v8's recipe retrained at seeds 1 and 2, with no
marker, lands within about a point of v8 (dev 57.9 and 57.6 against 58.2,
chat-dev 86.0 and 86.7 against 85.4), and v9-eos (56.5, 82.8) loses to every
seed, with CIs below 0 on dev and chat-dev. The losses are mostly
mid-sentence words that lose a ه of their own: طبقه → طبق, دقیقه → دقیق,
معلومه → معلوم, and نه → نا. The model learned a shortcut. Among typed
words, a final ه nearly always comes with the marker, so no marker came to
mean no ه. That is right for `ketabe man` and wrong for every word whose ه
is part of the stem.

Not shipped. The marker had to stop being a proxy for the ه.

**v9d: marker dropout, the last try.** The stop rule was fixed before the run:
ship only if `ketabe` flips with no ه added or lost elsewhere, there is no
real loss against v8 on dev, fixtures or chat-dev, and a second seed agrees.
Otherwise the item closes. `align-pairs.ts` now writes `final: false` on
mid-line words, so a synthetic word (no `final`) can be told apart. Training
left 25% of clause-final words unmarked and marked 50% of synthetic words,
drawn afresh every batch (`train.py --marker-drop 0.25 --marker-add 0.5`),
on v8's data at seeds 0 and 1:

| v8 → | dev | fixtures | chat-dev | chat-dev, accepted |
|---|---:|---:|---:|---:|
| v9d seed 0 | −1.7 (−2.5 to −0.9) | +0.5 | −2.2 (−4.4 to −0.1) | −3.6 (−5.4 to −1.8) |
| v9d seed 1 | −2.7 (−3.6 to −1.8) | +0.3 | −3.6 (−5.9 to −1.2) | −3.9 (−6.0 to −1.9) |

Dropout brought back نه and دقیقه mid-sentence, but not طبقه, معلومه or
دفعه, and both seeds now write بعد as بد, which is not a ه at all. `ketabe`
is right in every marker model; the rest costs 2 to 3 points each time.
**Closed.** `ketabe` stays a known miss on the model tier, written correctly
by the rules and the hybrid. The marker code stays, off unless the weights
ask for it. Why marking about 6% of the training words moves unmarked
mid-sentence words this much is not understood.

## 9. The loanword table — both families, 501 entries

`src/loan.ts` converts loanwords typed the English way (`backup` → بکاپ). Its
table is LLM output, reviewed the usual way, and recorded in
`data/lexicon/loanwords.tsv` (every entry with both verdicts and reasons) and
`data/provenance/loanwords.json`.

* **Written** by two Claude subagents (`loanwords-write.md`), five fixed
  categories each (tech, social, food, shopping, clothes; sport, school, cars,
  health, chat), blind to every evaluation set: 494 entries after 8 cross-shard
  duplicates. 15 chat brands were added by hand as a capped section.
* **Reviewed** by a separate Claude subagent and by luna
  (`loanwords-review.md`): is this the Persian people type, is this the English
  spelling people type, and does it collide with a Persian word. On the 486
  non-brand rows both accepted 459; luna alone rejected 20, mostly compounds
  (`powerbank`, `hotdog`) and collisions (`post` پست, `card` کارد, `cool`
  کول); Claude alone rejected 3 (`top` توپ, `gel` گل, `ampoule`); both
  rejected 4 (`bus`, `cash`, `trailer`, `poloshirt`). Only entries both accept
  are built.
* **A prompt error, and its fix.** The first review prompt listed "a brand" as
  a reason to reject, meant for the writers, and both families rejected all 15
  brands. The prompt was amended with a section on the brand list and both
  re-reviewed just those rows: 15 of 15 accepted by both. Both prompt hashes
  are in the provenance file.
* **A mechanical guard** (`scripts/build-loanwords.ts`) then drops Finglish
  homographs and any entry whose letters the rules engine already reads as a
  table word of frequency ≥ 0.25 that is not the entry: 29 drops, among them
  `love` (لو) and `short` (شرط), and some real loanwords, `file` (فیل) and
  `delete` (دلت). 445 are built.

## 10. Texting abbreviations — luna writes, both families review

`mrc`, `slm`, `nmdnm`: 150 entries written by luna (gpt-5.6-luna, xhigh) with
`abbreviations-write.md`. luna, not Claude, because the chat sets were typed
by Claude and a Claude-written list could simply agree with that typist.
Reviewed with `abbreviations-review.md` by a Claude subagent and by luna 6
(gpt-6-luna, xhigh; a first luna 5.6 review was stopped and discarded when the
user asked for luna 6). The families disagreed more than on any table so far:
Claude accepted 77, luna 138, both 73. Claude's rejects were mostly
ambiguity (`khst` خسته or خواست, `mshd` میشد or مشهد) and skeletons it had not
seen typed (`mmnon`, `dltng`). Of the 73, 14 English abbreviations are not
built because they translate (`idk` → نمیدونم), and the guard of §9, with
the corpus-evidence rule, drops 4 more (`drm`, `msh`, `asln`, `bzar`). 55
are built. Everything is in `data/lexicon/abbreviations.tsv` and
`data/provenance/abbreviations.json`.

The loanword guard (§9) was also changed this round: a collision now needs
evidence from the LLM-typed corpus (the colliding word typed at least 10
times, never with the loanword's spelling) before the loanword is kept. It
brought back 11 loanwords; the review verdicts are unchanged.

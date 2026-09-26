# Open items — resolved

The plan listed four questions to settle during M0, noting that a prior-art and
licensing sweep was in flight and had not returned, and that the candidate lists
should be treated as leads to verify rather than findings.

That sweep has since returned. This document records what it found, what changed
as a result, and what remains genuinely open.

---

## 0b. September 2026 — stretched words and loanwords

Full record in the README's round section and `data/provenance/loanwords.json`.

* **Stretched words are read without the stretch and written back with it**
  (`src/stretch.ts`), and the metric folds a stretch to one letter. Chat-dev
  has four stretched words, so this is worth +0.1 to +0.3 there (AI-typed) and
  nothing elsewhere; it is correctness, not a score.
* **A 445-word loanword table** (`src/loan.ts`, written by Claude, reviewed by
  Claude and luna, then a mechanical guard) moved chat-dev +3.1 to +3.6 on
  every tier with dev and the fixtures up slightly and gold flat. Chat-test
  gained +0.6 to +1.1. `mixed-004` (`email et ro befrest`) passes.
* **It costs 4.8 KiB of JS**, more than the 2–3 KiB estimated, because the
  table is bundled for the rules-only tier.

Closed from 0a's list: items 1 (English-spelled loanwords) and 2 (emphasis
doubling). Still open from this round:

1. **The guard is crude.** It drops a loanword when the engine reads its
   letters as a table word above a frequency of 0.25, which keeps `love` and
   `bus` Finglish but also loses `file`, `delete` and `battery`. A guard that
   knew how a Finglish typist would spell the colliding word (`fil`, not
   `file`) could keep them.
2. **Medial stretches** (`salaaaam`) collapse and are not written back.
3. **`pm`, `dm` and other chat abbreviations** are not in the table.
4. Still: the colloquial object marker on native words (`dishabo`), texting
   abbreviations (`mrc`), and a human-typed chat set.

## 0a. September 2026 — the chat round

Full record in `docs/llm-work.md` §8 and `data/chat/README.md`.

* **Chat is measured now, but AI-typed.** `data/chat/` has 200 dev and 100
  test messages, written and typed by LLMs, reviewed by two families. Its
  numbers are differences between engines, not absolutes.
* **The engine's chat gaps were mostly recall, not data.** Table words the
  channel could not reach (`kojai` → کجایی, `merci` → مرسی) and a tie-break
  that undid table words the stem lexicon lacks. Fixing them, plus 566 chat
  words added to the frequency table, moved chat-test +1.9 on rules and hybrid
  with gold flat. `heBorrow` is gone.
* **v8 ships with one known miss**: `ketabe` → کتاب on the model tier. It
  beats v7 on every surface, held-out ones included. A 489-line copula typing
  round moved that word 81/19 → 60/40 and broke دانشجوها, so it did not ship.
  The model is word-level and cannot see clause position; the fix is more
  likely a position feature or a scoring term than more data.
* **v8 lost ground on ZWNJ** (fixtures 92.6 → 77.8): chat lines are typed and
  written without the half-space, and the sentence split lets them train.

Still open, from the chat-dev errors that remain:

1. **English-spelled loanwords**: `cake`, `backup`, `message`, `offside`,
   `size` typed the English way for a Persian reference. The channel reads
   them letter by letter; a small loanword table is the likely fix.
2. **Emphasis doubling**: `merciii`, `kondeee`. Collapsing a run of three or
   more identical letters is cheap, but `aaaaaaa` is a fixture and has to keep
   working.
3. **The colloquial object marker** `-o` (`dishabo` → دیشبو) and texting
   abbreviations (`mrc`).
4. **A human-typed chat set.** The AI-typed one cannot say how well real chat
   converts, only which engine converts it better.

## 0. September 2026 — what the LLM-in-the-loop round settled

Full record in `docs/llm-work.md` and `docs/error-taxonomy.md`. What changed
here as a result:

* **"Recall-limited, not ranking-limited" was right, and it was fixable
  without data.** 87% of the reference words the rule engine got wrong were
  already in the 25k frequency table. A consonant-skeleton index over that
  table plus a noisy-channel score (`src/dictionary.ts`) moved rules +
  frequency from 66.9% to 72.6% on the audited gold, at zero bytes on the wire.
  The oracle's never-proposed share fell from 20.3% to 14.5%.
* **The gold set was worse than the CER quarantine could see.** A two-family
  LLM audit found 160 more rows whose two sides are different sentences, 237
  in all. Quarantining them is a +4.6 metric correction, reported as one.
* **There is now somewhere legitimate to tune.** `data/dev/`, 304 rows of real
  typing that the gold build rejected, repaired and labelled by two LLM
  families with a blind adjudicator.
* **The model's real-input deficit was a data problem.** 3,000 LLM-typed
  sentences took the same architecture from 55.0% to 69.2% on gold. Part of
  the old deficit was also a generator bug that wrote Persian letters into 5%
  of the synthetic Latin.
* **The bigram question is unchanged.** It is still opt-in, and still about
  +0.6 on top of everything else (74.1% vs 73.5%).

Still open, in order of expected value:

1. **Scale the LLM-typed corpus** (plan: ~20k sentences). The learning curve is
   +2 points per doubling and still rising, which plausibly closes the model's
   remaining 4.3-point gap to the rules. It is the largest cost item left.
2. **The register gap** is still the largest error bucket (24% of the rules'
   remaining errors on dev): formal typing over a colloquial reference. It is
   not reachable from the input. The `faithful` reference measures around it;
   nothing fixes it.
3. **LLM typing is 10–17 points easier to convert than human typing** of the
   same sentences. A distilled corpus that captured human noise (typos,
   mishearing, inconsistency) would be closer to the target distribution. No
   prompt tried here produced it.

---

## 1. Persian corpus and lexicon licensing — **resolved**

**Decision: ship Lilak.** 100,909 Persian stems, Apache-2.0, clean provenance.
Verified independently through the npm package `dictionary-fa@2.0.0`, which
redistributes the same dictionary and restates the license. Upstream SHA-256 and
byte counts are recorded in `data/provenance/lexicon.json`.

Measured on the real file, front-coded with a one-byte alphabet then Brotli-11:

| encoding | raw | Brotli | bytes/word |
|---|---:|---:|---:|
| plain UTF-8 list | 1,758,223 | 220,879 | 2.19 |
| front-coded + 1-byte alphabet | 394,803 | **100,736** | **1.00** |
| serialized DAFSA | 316,360 | 146,724 | 1.45 |

Our committed artifact lands at **98.3 KiB for 100,761 stems** — 0.999
bytes/word. Two findings worth keeping:

* **Front-coding is the highest-leverage trick**, 2.2× better than a plain list
  for about ten lines of decoder.
* **A compressed DAFSA is worse on the wire than a front-coded Brotli list.**
  Entropy coding beats structural sharing when the structure is already this
  regular. The automaton is the right *runtime* structure, not the right wire
  format.

### What was rejected, and why

| Resource | Problem |
|---|---|
| Hazm `words.dat` | MIT repo, but annotations derive from Peykare/Bijankhan — research/non-commercial. The MIT tag does not cure a non-commercial upstream. |
| `behnam/persian-words-frequency` | CC BY-SA 3.0. ShareAlike would infect a shipped frequency table — precisely the artifact it applies to. |
| Virastyar, perstem, PersianStemmer, Vajehdan | GPL / AGPL. |
| Three large GitHub word lists (240k/494k/700k) | No license file at all. |
| `Arshia82sbn/Finglish-To-Persian-Dataset-Large` | Tagged Apache-2.0 over GPLv3-derived Virastyar rules plus a corpus that names none of its sources. |

A cautionary note worth recording: the best-known existing Finglish converter
ships a 7.1 MB frequency file that is byte-identical to the CC BY-SA 3.0
`behnam` list, header included, inside an MIT package. That is the exact trap
this survey existed to avoid.

### Frequency ranking — **resolved**

Built from the Persian side of HomoRich (CC0-1.0): 25,000 words, 97.4% token
coverage, **55 KiB Brotli**, gold sentences excluded by the same guard as the
pronunciation dictionary. `data/lexicon/fa-frequency.bin`.

Worth **+13.0 points** to the rule baseline and **+3.9** to the model on the
fixtures — the best accuracy-per-byte in the project by a wide margin. It also
revealed that the rule baseline beats the learned model on real input (62.3% vs
51.2% with the corrected metric, 56.4% vs 46.8% as first published); see the
README.

A larger web corpus (MADLAD-400 fa, CC-BY-4.0) would extend coverage past
25,000 types. Register matters more than size here, and HomoRich's
conversational register is closer to Finglish than encyclopedic text, so the
gain from raw scale may be small.

### Superseded: the original frequency problem

**The lexicon ships without frequencies, and that costs real accuracy.**

Membership alone cannot rank `سلام` above `سلم` — both are attested Persian
words. The rule baseline demonstrates this directly: adding the 100k-stem
lexicon does not fix `salam`, because the lexicon says both spellings exist and
nothing says which is common.

The fix needs a permissively licensed corpus. **MADLAD-400 `fa` (CC-BY-4.0)** is
the one large Persian corpus with a genuine attribution-only license — no
ShareAlike, no NonCommercial — so derived frequency tables may be shipped.
`training/` has the pipeline; the corpus is not vendored because of its size.

Coverage, for scoping: 118 word types cover 50% of token mass, 896 cover 80%,
and 9,795 cover 99%. A 10,000-word frequency tier is ~18 KiB Brotli.

---

## 2. Does Dakshina cover Persian? — **resolved: no**

Dakshina covers 12 South Asian languages and **contains no Persian**. Its
Arabic-script members, Urdu and Sindhi, remain useful as method validation and
as the closest measured proxy, and its annotation protocol is the right template
for building a real Finglish gold set.

Related negative finding: **CC-100 has no romanized Persian.** The `_rom` files
exist only for bn/hi/ta/te/ur. Several secondary sources claim otherwise and are
wrong.

---

## 3. Realistic accuracy ceiling — **resolved: 85–92% word accuracy**

From the closest measured analogue, romanized → Perso-Arabic Urdu with real
human romanization:

| system | WER% | ≈ word accuracy |
|---|---:|---:|
| non-contextual pair 6-gram FST | 33.8 | 66.2% |
| non-contextual transformer | 44.5 | 55.5% |
| ensemble + word-level LM | 14.5 | 85.5% |
| **ensemble + contextual LM** | **12.2** | **87.8%** |
| mT5-large / ByT5-large | 13.0 / 13.9 | — |

Three conclusions that shaped this implementation:

1. **Context is worth ~21 WER points; architecture is worth under one.**
   Pair-6-gram, transformer, LSTM and ByT5 land within 0.8 CER of each other on
   Urdu single words (20.0 / 20.0 / 20.4 / 19.6). The language model is nearly
   everything; the architecture is nearly irrelevant.

   **The first half of that does not transfer, and this repository measured
   it.** The 21 points sit on top of a pair 6-gram FST, whose candidate recall
   is far higher than a beam over a grapheme table. `scripts/oracle.ts` puts a
   *perfect* reranker on this system at **+9.6 points**, because 20.3% of gold
   reference words are never in the candidate list at any beam width. The
   30k-pair bigram realizes +1.4 of that for the model and +0.9 for the rules —
   at 82 KiB per point against 8.9 for the frequency table, which is why it is
   built and measured but opt-in rather than shipped. The second half of the conclusion — architecture is nearly irrelevant
   — held exactly: three separate model-side changes here moved real accuracy
   by −0.3, 0.0 and −6.9.
2. **Large pretrained models lose here.** mT5-large and ByT5-large both score
   worse than an FST + LM noisy channel.
3. **A precomputed cache plus a sentence LM ties the full offline system**
   (12.2 = 12.2) at 620–2,670 chars/s. That is a validated browser design.

**85–92% word accuracy, ~40–60% sentence accuracy** is the honest band. Persian
ZWNJ placement has a human ceiling near 83% — real writers get it wrong one time
in six — so it should not be over-engineered.

---

## 4a. Real Finglish data — **found, and it changed the numbers**

**[mmahdibarghi/finglish-dataset](https://github.com/mmahdibarghi/finglish-dataset)
— MIT, 2,769 unique pairs, 1,906 kept after alignment filtering, 1,835 after a
later content-mismatch quarantine.** The Persian side is Mozilla Common Voice
Persian (**CC0**); the Finglish side was typed by a human annotator for a TTS
project. This is now `data/gold/gold.jsonl`, with the quarantined 71 rows
beside it in `gold-misaligned.jsonl`.

It is genuinely real typing: 17 of 18 colloquial markers probed are present
(`midouni`, `misheh`, `vaseh`, `nemidoonam`, `bashe`).

Two things it immediately delivered:

* **It corrected the corpus generator.** Measured over its 21,874 word tokens,
  `x` for خ occurs at 0.1% and `q` for ق at 3.9%, where the generator had been
  emitting both at 30%; and `a` outnumbers `aa` for long ɒː by roughly 3:1,
  where `aa` had been canonical. See `latinWeights` in `src/rules.ts`.
* **It moved the honest accuracy figure** from a guess to 44.6% word accuracy.

Its limits: one annotator, read-aloud rather than chat register, and ~30% of
source rows dropped as misaligned.

**Also verified usable:** GeoNames (**CC BY 4.0**) yields 235,564 Persian↔Latin
name pairs across Iran and Afghanistan, covering 45,335 Persian words absent
from the Lilak lexicon. But its romanization is BGN/PCGN standard
(`Kuh-e Shotor Khvab`), not natural typing, so it is proper-noun *coverage*, not
a source for the mapping.

**Definitively rejected:** `Arshia82sbn/Finglish-To-Persian-Dataset-Large`, the
largest Finglish dataset in existence at 9.85M pairs. Its own card says
`Generation Method: Synthetic (Rule-based + Dictionary)`, it is built on
GPL-3.0 Virastyar rules, and its source corpus states only that it merged
"several existing Persian datasets" while naming none of them.

**The wider supply is empty.** HuggingFace returns four datasets for
`finglish`/`pinglish`/`persian transliteration`/`romanized persian` combined,
three of which are GPT-generated TTS data with no declared licence.

## 4c. The pronunciation dictionary — **found, wired in, and it made things worse**

The generator's oldest documented weakness is that Persian does not write short
vowels, so it infers where one belongs and *samples which one* — کتاب is an even
chance of `ketab` or `kotab`. This document previously recorded that no
permissively licensed Persian pronunciation dictionary existed. That was wrong:

**[HomoRich G2P Persian](https://huggingface.co/datasets/MahtaFetrat/HomoRich-G2P-Persian)
— CC0-1.0, 528,875 grapheme/phoneme pairs**, from Common Voice (CC0), ManaTTS
(CC0), GPT-4o and human annotation. It gives کتاب `ketAb`, بزرگ `bozorg`,
دانشگاه `dAneSgAh` — exactly the information the generator was inventing.

Wiring it in and ablating at three rates, same 102k model, same recipe:

| pronunciation used | fixtures | real Finglish |
|---|---:|---:|
| **0% (sampled)** | **74.8%** | **44.6%** |
| 75% (blended) | 69.6% | 41.2% |
| 100% (verbatim) | 65.2% | 37.7% |

**Monotonic in the wrong direction, on both evaluation sets.** More correct
data, worse model.

The mechanism is diversity. Fixing each vowel to its true value cut distinct
spellings per word from **4.72 to 4.09**. A model that only ever sees `ketaab`
never learns that `ketab` and `ketob` are also کتاب, and real people type all
three. The variation that looked like noise was doing the work: it was teaching
robustness to how users actually type.

> For this task, **correct** training data is worse than **varied** training
> data. Stated here because it is counterintuitive and was not predicted.

`USE_PRONUNCIATION` is therefore `False`. The dictionary, the build script and
the leakage guard stay in the repository: the finding is worth keeping, and the
value should rise if coverage improves past today's 23.9% of the lexicon.
Turning it on requires a new measurement, not an assumption.

**Leakage guard, which is not optional.** HomoRich and the gold set both draw on
Common Voice: **97.3% of gold sentences (1,855 of 1,906, measured before the
content-mismatch quarantine) appear in HomoRich**.
`build_pronunciation.py` excludes every matching row — 17,215 of them, ~3% of
the source — before building. Without that, training on this dictionary and
reporting a gold score would be testing on the training data.

## 4b. Informal Persian data — **still the binding problem, and now quantified**

Finglish is chat Persian: `میرم`, `میخوام`, `چطوری`, `نمیدونم`. Formal corpora
contain almost none of it, and a domain-mismatched language model measured a
**5 WER point** penalty against an in-domain one.

`node scripts/oracle.ts --misses` now puts a number on it from this repository's
own data. Of the gold reference words the decoder never proposes, **48% are a
register mismatch** — the annotator typed formal Finglish over a colloquial
Persian original, `khaane` against `خونه` — against 13% long-vowel differences,
8% ع, and under 1% homophone letter classes. It is the largest single bucket in
the whole error budget, it is larger than everything candidate generation and
reranking can reach put together, and no amount of either fixes it: the
information needed to choose `خونه` over `خانه` is not in the input.

The two best-targeted resources both need an email:

* **ParsMap** — 50,000 informal↔formal sentence pairs plus a 49,397-entry
  lexicon, 3.36 MB. No license declared, gated.
* **HarfoSokhan** — 6M colloquial↔formal pairs. No public release found.

Excluded on licensing: **LSCP** (120M sentences from 27M casual tweets — the
most tempting informal resource) is CC BY-NC-ND. **OpenSubtitles fa** is legally
grey: ODC-BY covers OPUS's packaging, not fan translations of copyrighted
dialogue. **`SLPL/naab` is a trap** — tagged MIT, but it aggregates a
CC BY-NC-ND LSCP shard.

---

## Findings that revised the plan's own premises

Two measurements contradict assumptions the plan states. Neither changes the
architecture, but both change what the model is actually being asked to learn,
so they are recorded rather than quietly absorbed.

### The homophone consonants are not the main ambiguity

The plan says Finglish ambiguity "is dominated by homophonous consonants
(`s` → س/ص/ث, `z` → ز/ذ/ض/ظ, …)". Measured across 406,160 Persian word types,
collapsing exactly those classes:

* only **2.47% of types** and 13.85% of tokens fall into a colliding group;
* a most-frequent tie-break resolves **99.725% of tokens** correctly.

The alternatives are almost never real words — سال occurs 107,712 times, ثال
twice, صال once. Restricting to true phonemic homophones gives **414 groups,
0.20% of tokens**, and most are orthographic variants of the same word
(رئیس/رییس, مسئله/مساله). The one high-traffic genuine minimal pair is
صد (100) versus سد (dam).

> ص/ض/ط/ظ/ث/ذ/ح/ع are a **memorization and coverage** problem, not a
> disambiguation problem. Once you know which word was meant, the spelling is
> determined.

This *supports* the plan's capacity argument — there is less arbitrary
information to store than feared — but for a different reason than the plan
gives.

### The real ambiguity is vowels

Grouping a 47k-word pronunciation dictionary by realistic Finglish:

| convention | ambiguous forms | token mass on an ambiguous form |
|---|---:|---:|
| loose (`a` for both /a/ and /ɒː/) | 2.5% | **9.5%** |
| strict (`aa` for /ɒː/) | 0.9% | **0.6%** |

**100% of the loose-convention ambiguity is vowel- or ayn-related; none is
consonant-class.** Supporting and nudging users toward an `aa` convention
removes ~94% of residual ambiguity — the cheapest high-leverage decision
available. `src/rules.ts` therefore makes `aa` the canonical spelling of آ/ا.

### ZWNJ is structurally unreachable for rule tables

22.84% of Persian word types and 5.89% of tokens contain a ZWNJ, and the
positional rule tables every prior Finglish tool uses **cannot emit one**. Every
such word type is guaranteed wrong. Treating ZWNJ as an ordinary output label —
which the transducer does — is the fix, and it is visible in the results:
`mikonam` → `می‌کنم`.

---

## Implementation findings folded in

* **Weight encoding.** One ASCII character per weight from a 63-symbol alphabet
  beats base64 of bit-packed 6-bit codes by **25% after Brotli**, despite being
  33% larger before it. Bit-packing destroys the per-symbol regularity Brotli's
  context model exploits. Implemented in `export.py` / `src/quant.ts`.
* **Plain JS, not WASM.** V8 does not do on-stack replacement for WebAssembly,
  so a one-shot inference call completes in baseline code and never tiers up,
  while the equivalent JS loop does OSR mid-loop. The real comparison is
  optimized JS against *unoptimized* WASM.
* **Runtime code is a rounding error.** Measured on a comparable shipped model,
  weights are ~95% of the compressed payload and the entire hand-written runtime
  is ~3.4 KiB Brotli. Ours is 8.0 KiB. Budget weights; everything else is noise.
* **CPU-first is right.** The reference WebGPU-only project has no CPU fallback
  and throws without WebGPU; the other gates GPU behind a batch threshold of 32
  inputs or 512 tokens. For one short sentence, dispatch overhead dominates.

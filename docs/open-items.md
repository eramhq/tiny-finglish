# Open items — resolved

The plan listed four questions to settle during M0, noting that a prior-art and
licensing sweep was in flight and had not returned, and that the candidate lists
should be treated as leads to verify rather than findings.

That sweep has since returned. This document records what it found, what changed
as a result, and what remains genuinely open.

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

### Still open: frequency ranking

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
2. **Large pretrained models lose here.** mT5-large and ByT5-large both score
   worse than an FST + LM noisy channel.
3. **A precomputed cache plus a sentence LM ties the full offline system**
   (12.2 = 12.2) at 620–2,670 chars/s. That is a validated browser design.

**85–92% word accuracy, ~40–60% sentence accuracy** is the honest band. Persian
ZWNJ placement has a human ceiling near 83% — real writers get it wrong one time
in six — so it should not be over-engineered.

---

## 4. Informal Persian data — **confirmed as the binding problem**

Finglish is chat Persian: `میرم`, `میخوام`, `چطوری`, `نمیدونم`. Formal corpora
contain almost none of it, and a domain-mismatched language model measured a
**5 WER point** penalty against an in-domain one.

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

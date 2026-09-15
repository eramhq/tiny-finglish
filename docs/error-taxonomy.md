# Error taxonomy — what is still wrong, by measured size

Every word run the strict metric charges on the dev set, classified by an LLM
into a fixed taxonomy. This sets the order of work: a bucket's share of errors
bounds what fixing it can buy.

## Method

* **Surface.** `data/dev/dev.jsonl` (304 rows, 3,463 reference words), scored
  against `expected`. Never gold.
* **Engines.** `rules` is the rule engine as of this change: frequency, the
  dictionary and noisy channel, the detached-affix passes and the English-list
  fix. `model` is the 102k transducer with frequency rerank, sharing the same
  pipeline passes.
* **Runs.** `wordMismatches` in `src/metrics.ts` gives the minimal word
  alignment's non-matching runs: 1,545 distinct (reference run, output run)
  pairs across both engines. Every one was classified.
* **Classifiers.** Six Claude subagents, prompt
  `data/provenance/prompts/error-taxonomy.md`. They saw the input, reference,
  output and the differing run, and chose one of thirteen categories.
* **Verification.** The lead session read a 10% sample (142 items) and
  disagreed with 4 labels outright and 4 more as borderline, so about 94–97%
  agreement. Treat a bucket as accurate to a few points, not to one run.

## Result

"Word errors" is the run's edit cost, so the column sums to the distance the
strict metric charged.

| category | rules word errors | share | model word errors | share | example (rules) |
|---|---:|---:|---:|---:|---|
| register | 358 | 24.0% | 310 | 15.6% | کوچیک → کوچک |
| joining | 350 | 23.5% | 259 | 13.0% | چه قدر → چقدر |
| long-vowel | 224 | 15.0% | 541 | 27.2% | نشناسیه → نشنسیه |
| wrong-word | 106 | 7.1% | 43 | 2.2% | شوهرجان → شهر جان |
| ezafe-clitic | 104 | 7.0% | 216 | 10.9% | اسمونم → آسمون ام |
| input-typo | 99 | 6.6% | 118 | 5.9% | دوگ کونانت → دکنت |
| misaligned | 93 | 6.2% | 86 | 4.3% | همه → ∅ |
| ayn | 71 | 4.8% | 213 | 10.7% | عید فطره → اید فطر است |
| initial-vowel | 37 | 2.5% | 64 | 3.2% | ارزوها → آرزوها |
| homophone | 21 | 1.4% | 88 | 4.4% | تخصصشون → تخسسشون |
| doubled-ye | 11 | 0.7% | 19 | 1.0% | توییت → تویت |
| english | 8 | 0.5% | 11 | 0.6% | ۵ → 5 |
| khaa | 7 | 0.5% | 19 | 1.0% | میخاست → میخواست |
| **total** | **1,489** | | **1,987** | | |

## What it says

**Most of the rule engine's remaining error is not reachable from the input.**
Register (24.0%), input typos (6.6%) and misaligned spans (6.2%) add up to
37% of its errors. In each, what the typist typed does not determine the
reference. The `faithful` reference exists for exactly this reason. Against
it, the same engine scores 68.5% instead of 57.4%.

**Joining is the reference arguing with itself.** Of the 204 می/نمی verb
forms in the dev references, 120 are written solid and 84 spaced. The typist
writes every one of them solid. No output convention can match both, so a
change here would be tuning to noise. The orthographic tier folds it: rules
score 60.6% orthographic against 57.4% strict.

**Of the reachable buckets, long vowels are the largest,** at 15.0% for rules
and 27.2% for the model. The question is ا-or-nothing for a typed `a` in a word
the frequency table does not settle. A per-typist convention (a typist who
writes `aa` for ا means nothing by a bare `a`) was measured: +0.4 at best. Too
small to carry per-sentence state in the word memo, so it is not built.

**The model's errors are lexical, and the rules' are not.** Long vowel, ع,
homophone letters and ezafe make up 53% of the model's errors against 28% of
the rules'. Frequency reranking cannot fix that, because the right word is
often not among the model's candidates. So the model should be a *feature
inside the dictionary scorer* (plan step 3.3c), not a free generator. And
distilled training data should target vocabulary as much as spelling
variation.

## What was fixed first, and what each bought

Cumulative, on the final dev set (304 rows) and the 205-case fixture set.
Dev is scored strict against `expected` and `faithful`, and orthographic
against `faithful`.

| change | dev strict | dev faithful | ortho-faithful | fixtures |
|---|---:|---:|---:|---:|
| HEAD: rules + frequency | 44.3 | 54.2 | 62.2 | 72.5 |
| rule-table bugs (initial vowels, `iy`, خوا) and the English list | 44.9 | 54.8 | 62.9 | 74.2 |
| noisy channel + skeleton dictionary | 48.2 | 58.6 | 66.4 | 81.4 |
| detached ezafe (`sal e`, `ha ye`) | 52.3 | 62.9 | 71.2 | 82.4 |
| detached plural/comparative joined solid | **57.4** | **68.5** | **72.1** | **83.0** |

The last row is mostly an orthographic convention, and it is reported as
one: +5.1 strict, but only +0.9 on the orthographic tier, which already folds
that join.

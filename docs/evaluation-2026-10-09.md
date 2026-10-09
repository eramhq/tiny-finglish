# Verification record — 9 October 2026

This is a documentation verification run, not a tuning or training round.
Engine revision: `96b9ff39d9accff72b8d634925833a5d6f337c97`.
Node: `24.8.0`. Runtime source, model, and datasets were not changed.

## Publication check before the first GitHub release

Direct HTTPS requests to `https://registry.npmjs.org/tiny-finglish` returned
HTTP 404 with `{"error":"Not found"}`; GitHub's
`https://api.github.com/repos/eramhq/tiny-finglish/releases?per_page=10` returned
HTTP 200 with an empty list. No registry installation or published-release claim
is made by that check. The subsequent `v0.1.0` GitHub release publishes this
documentation snapshot; it does not publish an npm package. The website archive's recorded source revision matches this checkout.

## Gold word accuracy

Dataset: `data/gold/gold.jsonl`, 1,669 audited human-typed rows, from one
annotator and read-aloud material. Each row has `expected` and `faithful`;
the latter is a reviewed LLM edit, not an independent human reference.
See [dataset provenance and caveats](../data/gold/README.md).

Method: existing `scripts/run-fixtures.ts` / `_report.ts`, aggregate word
alignment counts, with `src/metrics.ts` normalization. “Orthographic” forgives
selected spelling and spacing differences. “Strict” is still normalized word
scoring, not byte equality. All rows below explicitly exclude the optional
lexicon. All except bare rules load the committed frequency and vowel tables.
Only the named bigram row loads bigrams. Defaults: beam 8, three reported
candidates and three alternatives, default punctuation/protection behavior.

| Configuration | Orthographic vs expected | Strict vs expected | Orthographic vs faithful |
|---|---:|---:|---:|
| Rules, no external data | 59.5% | 54.9% | 65.2% |
| Rules + frequency + vowels | 83.1% | 76.3% | 90.7% |
| Rules + frequency + vowels + bigram | 83.4% | 76.6% | 91.1% |
| Model-only + frequency + vowels | 82.7% | 73.3% | 90.3% |
| Hybrid + frequency + vowels | 84.2% | 74.6% | 91.9% |

These reproduce the previous README's named no-lexicon configurations to its
reported precision. They do not validate its older paragraphs as current facts.
The hybrid report gives a sentence-bootstrap 95% interval of 83.2–85.0 for the
orthographic-vs-expected score; this is dataset sampling uncertainty, not
per-span `confidence` or an estimate of all users' accuracy.

Reproduce, from the repository root:

```sh
node --experimental-strip-types scripts/run-fixtures.ts --gold --rules --no-frequency --no-vowels --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --rules --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --rules --bigram --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --no-lexicon
node --experimental-strip-types scripts/run-fixtures.ts --gold --hybrid --no-lexicon
```

The report script selects model-only unless `--hybrid` is supplied, and loads
lexicon unless excluded. Its defaults differ from the public constructor.
Do not tune to this gold report; use development sets.

## Size verification

At the same revision, `node --experimental-strip-types scripts/size.ts --tiers`
produced 21.4 KiB Brotli for the main entry, 18.8 KiB for rules, and 0.8 KiB for
normalize. It does not measure the metrics subpath, so the old README's metrics
row was not reverified. Method: esbuild browser ESM, ES2022, minified,
`legalComments: "none"`, gzip level 9 for tier entries, Brotli quality 11.
No dataset is involved in byte measurement. License notices must still accompany
distribution even though this measurement strips bundle comments.

Weights: 84.4 KiB Brotli; frequency: 55.3 KiB; vowels: 13.3 KiB. Code plus these
assets totals 174.4 KiB after rounding. Rules plus both tables totals 87.4 KiB.
Weights are compressed by the script; table sizes are the already-compressed
repository artifacts, not the uncompressed packaged `.bin` files. Optional
bigram is 73.6 KiB and lexicon 98.3 KiB by the same on-disk method.
These are artifact measurements, not a measurement of the Eram page's network
transfer, memory footprint, or browser startup time. No latency benchmark was
rerun for this documentation change; old speed claims are not repeated as
current guarantees.

## Inputs pinned by SHA-256

| File | SHA-256 |
|---|---|
| `data/fixtures/weights.json` | `46906105466873f93f2be289de93477775ffc7a406ace436a4d013e504d72d47` |
| `data/gold/gold.jsonl` | `c0ca539b69f0c4ab0964c233e7e21362adb2d63d08ee1801bb6f2c6c9cbc04bc` |
| `data/lexicon/fa-frequency.bin` | `81c3a92c26deb1a53675b9dd19d55dbcebc8289f7384b36b2445cbd87e5b8c52` |
| `data/lexicon/fa-vowels.bin` | `0cd2e39f183e8cd3d31cdaa9a7d6813643d9334fbe1b788b44dff2d6a36c721d` |
| `data/lexicon/fa-bigram.bin` | `c170405789d33960a5a316814582db1451e3382243d69231106f2f0d09a9d0b2` |

## Example verification

Run `npm run build && node scripts/check-docs.mjs`. The checker executes the
JavaScript fences and compares their adjacent recorded output, bundles and
checks the browser loader with package asset bytes, and exercises worker
controller scheduling. English/Persian executable examples must stay identical.
Examples document observed engine behavior, including bare-rule misspellings,
punctuation in English text, and missing candidates; they are not edited to
look correct.

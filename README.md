# Tiny Finglish

Convert Finglish, Persian typed with Latin letters, into Persian script. This is
transliteration, not translation or rewriting. Conversion runs locally on the
CPU; browser applications download static model/data assets separately.

**[English guides](docs/en/overview.md) · [راهنمای فارسی](docs/fa/overview.md)**

## Availability and installation

The [v0.1.0 GitHub release](https://github.com/eramhq/tiny-finglish/releases/tag/v0.1.0)
provides a source snapshot with bilingual documentation. It is not an npm
publication: the npm registry returned 404 for `tiny-finglish` when checked on
9 October 2026. The package version is `0.1.0`. Eram's website uses a source archive from
`96b9ff39d9accff72b8d634925833a5d6f337c97`.

Use Node 24 (verified on 24.8.0) to build a local archive from this checkout:

```sh
npm ci
npm run build
npm pack
```

Install the resulting `tiny-finglish-0.1.0.tgz` in your application by its local
path. Nothing is published by these commands. See [installation](docs/en/installation.md)
for a pinned checkout and [Node requirements](docs/en/node.md) for the difference
between the declared runtime minimum and the source-build tools.

## Quick start

After installing the archive, save this as `quick-start.mjs` and run
`node quick-start.mjs`:

```js
import { transliterate } from "tiny-finglish";
console.log(transliterate("salam, emrooz miram shiraz").text);
```

```text
سلم، امروز میرم شیرز
```

That is the actual bare **rules-only** output. For `سلام، امروز میرم شیراز`,
load the model plus frequency and vowel tables using the complete
[browser](docs/en/browser.md) or [Node](docs/en/node.md) hybrid example.
The library never loads those assets automatically. The website's hybrid setup
excludes optional bigrams and lexicon.

## Use the library

- [Engine configurations and tradeoffs](docs/en/configurations.md)
- [Protect names, links, and mixed text](docs/en/input-options.md)
- [Results, candidates, offsets, and confidence](docs/en/results.md)
- [Review and copy output](docs/en/ui-integration.md)
- [Workers, lazy loading, errors, and caching](docs/en/workers.md)
- [Limitations and evaluation](docs/en/limitations.md)

Keep the original input and let users review suggestions. Recognized copy spans
are preserved; English/name detection is imperfect. Confidence is an internal
ranking signal, not measured accuracy. Current measurements and their exact
configuration are in the [verification record](docs/evaluation-2026-10-09.md).

## Development and research

```sh
npm test
npm run typecheck
npm run build
node scripts/check-docs.mjs
npm run playground
```

The playground's rules setting includes word tables when available; it is not
the no-data baseline. Build it with `npm run playground:build`.

[Architecture](docs/architecture.md), [model card](docs/model-card.md),
[results](docs/results.md), [benchmarks](docs/benchmarks.md),
[research and provenance](docs/llm-work.md), [contributing](docs/contributing.md),
[PLAN](PLAN.md), and [ROADMAP](ROADMAP.md) remain available. Older research figures
refer to the configurations and datasets of their rounds. The
[historical README](docs/readme-history.md) preserves previous discussion,
training commands, milestone details, and measurements outside public navigation.

Only pages listed in [docs/navigation.json](docs/navigation.json) belong to the
shared website guides. See the [documentation review notes](docs/documentation-review.md)
for local preview and release follow-up.

## License

MIT; retain [LICENSE](LICENSE) and [NOTICE](NOTICE). NOTICE preserves attribution
for HomoRich G2P Persian (CC0), evaluation data from finglish-dataset (MIT), and
the optional Lilak stem list (Apache-2.0), as well as excluded data sources.

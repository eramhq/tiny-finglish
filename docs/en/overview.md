---
title: "Tiny Finglish"
description: "Choose a setup for converting Latin-script Persian into Persian writing."
---

# Tiny Finglish

Tiny Finglish converts Finglish, Persian typed with Latin letters, into Persian script. It is a transliterator: it does not translate English or rewrite a message into a different register. Its output is a suggestion the writer can review.

## Start with the right configuration

Before `configure()` is called, the module-level `transliterate()` uses rules without external data. The Eram website uses a hybrid engine: model weights, rules, a frequency table, and a vowel table, with no optional bigram or lexicon. These are different configurations and can produce different text.

| Setup | What you supply | Use it when |
|---|---|---|
| Rules only | Nothing | You want a baseline without asset loading |
| Rules with tables | Decoded frequency and vowel tables | You want dictionary-informed ranking without the neural runtime |
| Hybrid | Model plus both decoded tables | You want the same configuration as the website |
| Model-only generation | Model and `hybrid: false`; tables optional | You want to compare model candidates; shared pipeline rules still run |

For the verified input `salam, emrooz miram shiraz`, bare rules return `سلم، امروز میرم شیرز`; the website configuration returns `سلام، امروز میرم شیراز`. See the complete [Node setup](node.md) and [configuration comparison](configurations.md).

## Choose your next step

Start with [installation](installation.md), then use the [browser loader](browser.md) or [Node loader](node.md). Learn how to [protect mixed text](input-options.md), [read results and candidates](results.md), and [build a review interface](ui-integration.md). For typing interfaces, use a [worker](workers.md).

## Local processing and downloads

The library runs synchronously on the CPU and makes no network requests. A browser application normally downloads static JavaScript, model, and table assets before converting locally. Downloading those assets is separate from sending input text anywhere. Logging, analytics, persistence, and network policy belong to the application; the library cannot guarantee the privacy of its host page.

## Availability and provenance

The [v0.1.0 GitHub release](https://github.com/eramhq/tiny-finglish/releases/tag/v0.1.0) contains these guides and the source snapshot. The npm registry returned 404 for `tiny-finglish` when checked on 9 October 2026; publishing a GitHub release does not publish the npm package. The website uses an archive built from source revision `96b9ff39d9accff72b8d634925833a5d6f337c97`. The examples here were verified against that same engine revision. Follow the archive workflow in [installation](installation.md); do not assume an npm registry release exists.

The code is MIT licensed. Retain [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE) when redistributing. NOTICE records HomoRich data attribution, the optional Lilak lexicon, evaluation-data sources, and deliberate exclusions. Research and contributor documents remain outside public navigation; start with [architecture](../architecture.md), [results](../results.md), and [contributing](../contributing.md).

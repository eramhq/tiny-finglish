---
title: "Install from a source archive"
description: "Build the unpublished package locally and run a verified first conversion."
---

# Install from a source archive

## Check availability before installing

As checked on 9 October 2026, [the npm registry](https://registry.npmjs.org/tiny-finglish) returns HTTP 404. The [v0.1.0 GitHub release](https://github.com/eramhq/tiny-finglish/releases/tag/v0.1.0) makes the source and these guides available, without publishing the npm package. `npm install tiny-finglish` is therefore not a working registry-install instruction for this revision. The package manifest's `0.1.0` matches the GitHub release; it does not imply npm publication.

## Build a pinned source archive

Use Node 24 for this workflow (verified with 24.8.0). The package declares Node `>=20.10`, but its build runs a TypeScript script with `--experimental-strip-types`, unavailable in Node 20. See [runtime requirements](node.md).

```sh
git clone https://github.com/eramhq/tiny-finglish.git
cd tiny-finglish
git checkout v0.1.0
npm ci
npm run build
npm pack
```

`npm pack` runs `prepack`, which builds again, and creates `tiny-finglish-0.1.0.tgz`. It does not publish anything. Preserve its source commit and checksum in your application's dependency records. The archive contains compiled ESM, declarations, model weights, both word tables, README, LICENSE, and NOTICE. Optional bigrams and the lexicon remain in the repository.

From your application directory, install the generated archive using its actual path:

```sh
npm install /absolute/path/to/tiny-finglish/tiny-finglish-0.1.0.tgz
```

For a reproducible application build, store the reviewed archive in a vendor directory and commit the application's lockfile. Eram currently follows that pattern with a commit-named archive.

## First run without external data

Save this as `quick-start.mjs` in the application and run `node quick-start.mjs`:

```js
import { transliterate } from "tiny-finglish";

console.log(transliterate("salam, emrooz miram shiraz").text);
```

```text
سلم، امروز میرم شیرز
```

That imperfect output is the actual rules-only result. No model or word table was loaded. Use the [Node hybrid loader](node.md) or [browser hybrid loader](browser.md) to produce `سلام، امروز میرم شیراز` for the same input. A bare call is not equivalent to the website demo.

## Develop in this repository

After `npm ci`, run `npm test`, `npm run typecheck`, and `npm run build`. `npm run playground` starts the Vite playground; `npm run playground:build` builds it. Its “rules” choice still loads the frequency and vowel tables when available. To test true no-data rules, construct an empty engine as above.

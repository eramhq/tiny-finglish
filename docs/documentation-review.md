# Documentation review — 9 October 2026

The public contract is `docs/navigation.json`: ten focused guides, each in
English and Persian. No shared images are needed. Internal architecture,
research, model, provenance, and contributor material remains outside navigation.

## Scope

Started from clean Tiny Finglish revision
`96b9ff39d9accff72b8d634925833a5d6f337c97`. Changes cover documentation, its
verification script, and release version metadata. No runtime, model, data, or
package export changes. The release updates package metadata to version `0.1.0`.
The initial review left everything uncommitted. A subsequent request authorized
committing and publishing the `v0.1.0` GitHub release.
The package version is `0.1.0`; npm publication and website documentation
sync remain separate.

## Local website preview

The website checkout has existing tracked and untracked work. Preserve it.
Its `site/docs-publishing.md` defines the contract and `site/README.md` contains
the Persian writing guidelines used here.

Two current website issues prevent the normal CLI preview for this project:

- `npm run docs:local -- <path>` calls `prepareLocalDocs` without a repository
  argument, so it defaults to `abzar-php` and would use the wrong identity.
- Even calling `prepareLocalDocs(source, "tiny-finglish", output)` directly
  fails with “Repository is not in the website catalog”: Tiny Finglish is in
  `projects.ts` but absent from `src/data/docs-manifest.json`.

These are website follow-ups, not reasons to edit its source or public snapshots
in this documentation change. A running preview on port 4323 was left alone.

For this review, the website was copied to a temporary directory, with its
existing dependencies reused. Its unchanged `collectDocs` validator and
`writeDocs` helper generated the 20 records under that copy's `.local-docs/`.
Only the copy's ignored local manifest received the Tiny Finglish record. Astro
ran with `ERAM_LOCAL_DOCS=1` on port 4325. No website source, public manifest,
release lock, or existing local snapshot was changed. All 20 routes return HTTP
200, carry the unpublished notice, link their language counterpart, and have no
translation fallback. Persian layout and the EN/FA page-preserving switch were
also inspected in the browser.

The temporary review server is at
[English overview](http://127.0.0.1:4325/en/docs/tiny-finglish/overview/) and
[Persian overview](http://127.0.0.1:4325/fa/docs/tiny-finglish/overview/).
It contains a snapshot, so later source edits require regenerating that local
snapshot. It is not a persistent deployment or a public URL.

Links to unlisted research files are intentionally rewritten to GitHub at HEAD
by the website. New uncommitted evaluation/history files therefore cannot be
opened through those preview GitHub links until a commit containing them exists.
Read those files directly in this checkout during review. Relative links between
all listed guides already resolve inside the local website.

## Links to use after a reviewed release

For either `en` or `fa`, under `/{locale}/docs/tiny-finglish/`:

| Task | Slug |
|---|---|
| Installation | `installation/` |
| Browser setup matching Eram | `browser/` |
| Node setup and entry points | `node/` |
| Engine configuration | `configurations/` |
| API results and confidence | `results/` |
| Limitations and troubleshooting | `limitations/` |

These are preview/future release routes, not a claim that public guides are
already published. Public import requires a published GitHub release containing
the navigation and guides. The current npm archive excludes `docs/`; the website
imports release source, so that exclusion does not block documentation import.

## Existing link updates

- `docs/results.md` linked the old README accuracy table; it now links the
  preserved table in `docs/readme-history.md`.
- `ROADMAP.md` linked the old milestone anchor; it now links the historical
  README's milestone section.
- Fair-grading references in `docs/benchmarks.md` and `docs/contributing.md`
  now link the historical discussion instead of a removed README section.
- External consumers of removed README anchors should use the new guides or
  the historical README as appropriate. No website source was edited here.

The historical README is explicitly labelled as a record with outdated claims.
Its relative links were adjusted for the archive location. Original research
files retain their detail and chronological measurements.

## Release follow-up

Resolve the declared Node minimum versus source-build command mismatch. Review
source/API comments about Persian-only punctuation, probability normalization,
and decode options versus cache keys; the guides document observed behavior
without modifying it. Decide whether those behaviors need a separately reviewed
runtime change. Reverify publication status, supported runtimes, and examples
against the chosen release commit. Preserve LICENSE and NOTICE. Publishing a
release is authorized for this documentation snapshot; refreshing the website
remains separate future work. These known engine/tooling limitations are
documented in the release rather than changed in this documentation update.

## Checks completed

- `npm test`: 274 tests across 16 files passed.
- `npm run typecheck` and `npm run build`: passed.
- `node scripts/check-docs.mjs`: 20 page contracts and language counterparts,
  frontmatter, relative link/asset existence, Persian mark scan, and code parity
  passed; 10 actual JavaScript fences matched their recorded output. Browser,
  worker, and UI snippets passed strict TypeScript checking. Browser asset load
  and failure paths, selected-candidate output, lazy worker scheduling, stale
  responses, retry, timeout, and disposal checks passed.
- `npm pack` into a temporary directory and installation in an isolated app:
  exported assets, LICENSE/NOTICE, and the documented hybrid loader passed.
- Five existing gold reports and the existing size report reproduced the named
  figures in [the verification record](evaluation-2026-10-09.md). No training or
  tuning took place; historical latency figures were not remeasured.
- `npm run playground:build`: passed; Vite reports its existing large-chunk
  warning for the playground bundle.
- Website `npm run docs:test`: all six importer/release tests passed. The
  unchanged importer accepted all 20 pages; all rendered preview routes passed.
- `git diff --check`: passed. Website source hashes and its public snapshot/lock
  were compared against their pre-review state.

There are no missing translations among the ten listed guides. Supporting
research, evaluation, and contributor records are intentionally not public
navigation pages and remain in English.

/**
 * Every comparison subject behind one contract.
 *
 * **This module is isomorphic on purpose.** It imports no DOM and nothing
 * Vite-specific, so `scripts/compare.ts` runs the exact same adapters under
 * Node that the page runs in the browser. That is the same discipline
 * `src/metrics.ts` follows and for the same reason: two definitions of "what
 * NeveshtYar outputs for this sentence" would drift, and the first symptom
 * would be a page quoting numbers the repository cannot reproduce.
 *
 * The contract is `convert(string) => string` because that is all a third
 * party offers. Ours additionally expose `detail()`, which returns the full
 * `TransliterationResult` — the plan called for a `spans()` method, but the UI
 * needs spans *and* confidence from the same pass, and running the pipeline
 * twice to fetch them separately would misreport the per-call latency the page
 * displays next to them.
 */

import { Transliterator } from "../../src/index.ts";
import type { BigramTable } from "../../src/bigram.ts";
import type { FrequencyTable } from "../../src/frequency.ts";
import type { VowelTable } from "../../src/vowels.ts";
import type { WeightArtifact } from "../../src/quant.ts";
import type { TransliterationResult } from "../../src/types.ts";
import { naiveTransliterate } from "../../src/naive.ts";

export type EngineKind = "ours" | "third-party" | "baseline";

export interface Engine {
  id: string;
  label: string;
  kind: EngineKind;
  /** One line on what this subject actually is. Rendered under the label. */
  note: string;
  /** False when a vendor source could not be loaded. The row still renders. */
  available: boolean;
  convert(input: string): string;
  /** Ours only — spans and confidence from the same pass as `convert`. */
  detail?(input: string): TransliterationResult;
}

export interface OurAssets {
  weights?: WeightArtifact | undefined;
  lexicon?: ReadonlySet<string> | undefined;
  frequency?: FrequencyTable | undefined;
  bigram?: BigramTable | undefined;
  /** Rides with `frequency`, as in `buildTransliterator`. */
  vowels?: VowelTable | undefined;
}

// ------------------------------------------------------- URL preservation

/**
 * The protection probe.
 *
 * Kept here rather than in the page so the script and the browser score it
 * identically. An engine "preserves" only if every one of these survives
 * byte-identical — not merely recognizably, but exactly, because a URL that
 * arrives with one character changed is a dead link either way.
 */
export const PROTECTION_PROBE =
  "in link https://example.ir/a?b=1 va ali@example.com ro bebin";

export const PROTECTED_SUBSTRINGS: readonly string[] = [
  "https://example.ir/a?b=1",
  "ali@example.com",
];

export function preservesProtectedSpans(engine: Engine): boolean {
  if (!engine.available) return false;
  let output: string;
  try {
    output = engine.convert(PROTECTION_PROBE);
  } catch {
    return false;
  }
  return PROTECTED_SUBSTRINGS.every((needle) => output.includes(needle));
}

// ------------------------------------------------------------------- ours

/**
 * Our three configurations, in the order the page reports them.
 *
 * **Each row is exactly one CLI invocation**, so every number the page shows
 * can be re-derived from a documented command rather than merely resembling
 * one:
 *
 *   model + frequency   node scripts/run-fixtures.ts [--gold]
 *   rules + frequency   node scripts/run-fixtures.ts --rules [--gold]
 *   rules, no frequency node scripts/run-fixtures.ts --rules --no-frequency [--gold]
 *
 * None of them carries the sentence-context pass unless `options.bigram` says
 * so, matching `buildTransliterator`, which loads the bigram only for
 * `--bigram`. The artifact is real and measured; it is not in the shipped bytes
 * and so it is not in the numbers the page prints beside a size.
 *
 * Note what the third one is not. `--no-frequency` drops the frequency table
 * and keeps the lexicon, because that is what the flag does in
 * `scripts/_load.ts` — `buildTransliterator` gates `model` and `frequency` and
 * always loads the lexicon. Cutting the lexicon here too would be a defensible
 * ablation but a different one, and the row would then match no command anyone
 * can run. The genuinely stripped-down configuration is the naive floor below.
 */
export function buildOurEngines(
  assets: OurAssets,
  /**
   * Drop the lexicon from all three. Used only by `scripts/compare.ts`, to
   * measure what the lexicon is worth — it is loaded for every accuracy figure
   * this project reports but is not in the shipped byte count, and the page
   * should state the size of that gap rather than leave it implied.
   */
  options: { lexicon?: boolean; bigram?: boolean } = {},
): Engine[] {
  const withLexicon = options.lexicon !== false;
  const withBigram = options.bigram === true;
  const make = (flags: { model?: boolean; frequency?: boolean }): Transliterator =>
    new Transliterator({
      ...(flags.model && assets.weights ? { model: assets.weights } : {}),
      ...(withLexicon && assets.lexicon ? { lexicon: assets.lexicon } : {}),
      ...(flags.frequency && assets.frequency ? { frequency: assets.frequency } : {}),
      ...(flags.frequency && assets.frequency && assets.vowels ? { vowels: assets.vowels } : {}),
      ...(withBigram && assets.bigram ? { bigram: assets.bigram } : {}),
    });

  const wrap = (
    id: string,
    label: string,
    note: string,
    engine: Transliterator,
    available: boolean,
  ): Engine => ({
    id,
    label,
    kind: "ours",
    note,
    available,
    convert: (input) => engine.transliterate(input).text,
    detail: (input) => engine.transliterate(input),
  });

  return [
    wrap(
      "ours-model-frequency",
      "tiny-finglish — model + frequency",
      "The shipped default: 102k-parameter transducer, int6, reranked by corpus frequency.",
      make({ model: true, frequency: true }),
      Boolean(assets.weights),
    ),
    wrap(
      "ours-rules-frequency",
      "tiny-finglish — rules + frequency",
      "No neural model. Grapheme rules, a beam, and the same frequency table.",
      make({ model: false, frequency: true }),
      true,
    ),
    wrap(
      "ours-rules",
      "tiny-finglish — rules, no frequency",
      "Grapheme rules, a beam and the lexicon, with the frequency table removed.",
      make({ model: false, frequency: false }),
      true,
    ),
  ];
}

// ---------------------------------------------------------------- the floor

export function naiveEngine(): Engine {
  return {
    id: "naive",
    label: "naive letter substitution",
    kind: "baseline",
    note: "Greedy longest match, highest-weight Persian per unit. ~30 lines, no search.",
    available: true,
    convert: naiveTransliterate,
  };
}

// ------------------------------------------------------------- NeveshtYar

/**
 * The ten global-scope scripts NeveshtYar's own evaluation harness loads, in
 * its order. Mirrors `evaluation/load-converter.mjs` in the upstream repo;
 * the order matters because the later files call into the earlier ones.
 */
export const NEVESHTYAR_FILES: readonly string[] = [
  "language_profiles.js",
  "keyboard_layout.js",
  "context_intent.js",
  "normalization_intent.js",
  "lexical_priors.js",
  "finglish_source_model.js",
  "transliteration_intent.js",
  "spell_correction.js",
  "universal_correction.js",
  "logic.js",
];

/**
 * Build the NeveshtYar engine from its concatenated source.
 *
 * Upstream loads these files with `node:vm`, which is why the plan flagged the
 * browser as the risky piece. It turned out not to be: the files declare plain
 * globals rather than modules, so a single function scope holds them just as
 * well as a VM context does, and `node:vm` was never doing anything a browser
 * cannot. The caller supplies the source — `fetch` in the page, `readFileSync`
 * in the script — so this function stays isomorphic.
 *
 * `new Function` on third-party source is deliberate and confined to the
 * playground: the code is pinned to a git tag in `package-lock.json`, it is
 * never in the published package, and the page only loads it when the reader
 * asks for it.
 */
export function createNeveshtYarEngine(source: string | null): Engine {
  const base = {
    id: "neveshtyar",
    label: "NeveshtYar 4.9.2",
    kind: "third-party" as const,
    note: "The only JavaScript implementation found. A browser extension; ~3.5 MiB of priors.",
  };

  if (source === null) {
    return { ...base, available: false, convert: (input) => input };
  }

  let word: (text: string) => string;
  try {
    // `chrome`, `window` and `document` are the shims upstream's own harness
    // passes in. Handing them in as parameters keeps the sources from reaching
    // for the page's real globals.
    const factory = new Function(
      "chrome",
      "window",
      "document",
      `${source}\n;return typeof smart_farsi_converter === "function" ? smart_farsi_converter : null;`,
    ) as (chrome: object, window: object, document: object) => ((text: string) => string) | null;
    const converter = factory({}, {}, {});
    if (typeof converter !== "function") {
      return { ...base, available: false, convert: (input) => input };
    }
    word = converter;
  } catch {
    return { ...base, available: false, convert: (input) => input };
  }

  return {
    ...base,
    available: true,
    convert: (input) => convertNeveshtYarText(word, input),
  };
}

/**
 * Feed NeveshtYar one word at a time.
 *
 * **This adapter is a fairness decision, and the page says so.** Its
 * `analyzeFsaFinglishIntent` guards on `/^[a-z]+$/` over the *whole* input, so
 * anything with a space in it is rejected before conversion is attempted —
 * hand it a sentence and it hands the sentence straight back. Scoring that
 * would produce a 0% that says nothing about the engine and everything about
 * the harness. It is built to fix the word you just typed in a text field, so
 * that is how it is measured here: split on Latin runs, convert each, rejoin.
 *
 * The cost of the split is real and is not hidden — it is why the engine cannot
 * use sentence context, and it is visible in the output on multi-word input.
 */
function convertNeveshtYarText(word: (text: string) => string, input: string): string {
  return input.replace(/[A-Za-z]+/g, (run) => {
    try {
      const out = word(run);
      return typeof out === "string" ? out : run;
    } catch {
      return run;
    }
  });
}

/**
 * The comparison benchmark — what else exists, and how this compares to it.
 *
 *     node scripts/compare.ts            # regenerate data/results/comparison.json
 *     node scripts/compare.ts --print    # ...and show the tables
 *
 * Writes `data/results/comparison.json` following the `m2-curve.json` pattern:
 * a provenance header, measured figures, and no hand-typed numbers. Every
 * figure in the file is produced by this script on the machine that runs it,
 * with one clearly-flagged exception — two subjects that cannot be installed
 * (a PHP port and a proprietary Windows desktop app) carry `"measured": false`
 * and a citation, and the page renders them in a separate block that says so.
 *
 * The survey behind the subject list: no npm package converts Finglish to
 * Persian. Everything on npm carrying `finglish` or `pinglish` in its name goes
 * the other way, Persian to Latin, for URL slugs — `pinglish`,
 * `persian-to-pinglish`, `@pinooxhq/slug`, `f2f` and `fenglish` were each
 * checked and each exports only that direction. Of the handful of real
 * implementations anywhere, exactly one is JavaScript.
 *
 * Scoring is `wordAccuracy` from `src/metrics.ts` for every subject including
 * the third parties, so no subject is scored by a metric of its own choosing.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import { normalize } from "../src/normalize.ts";
import { characterErrorRate, wordAccuracy } from "../src/metrics.ts";
import { loadBigram, loadFixtures, loadFrequency, loadLexicon, loadModel, loadVowels, type Fixture } from "./_load.ts";
import {
  buildOurEngines,
  createNeveshtYarEngine,
  naiveEngine,
  preservesProtectedSpans,
  NEVESHTYAR_FILES,
  PROTECTED_SUBSTRINGS,
  PROTECTION_PROBE,
  type Engine,
} from "../playground/src/engines.ts";

const root = new URL("..", import.meta.url);
const PRINT = process.argv.includes("--print");

const DATASETS = [
  { id: "gold", label: "real human Finglish", file: "data/gold/gold.jsonl", headline: true },
  { id: "fixtures", label: "hand-authored fixtures", file: "data/fixtures/fixtures.jsonl", headline: false },
  { id: "authored", label: "author-written gold", file: "data/gold/authored.jsonl", headline: false },
] as const;

// ------------------------------------------------------------------ scoring

interface Score {
  n: number;
  /**
   * The raw counts, not just the ratio.
   *
   * Word accuracy is stored as the integers it is computed from so that the
   * page divides them itself and rounds exactly once. Storing a pre-rounded
   * ratio is how the first run of this script reported 56.5% where the CLI
   * reports 56.4%: the true figure is 56.4498%, and rounding it to four places
   * before rendering to one place rounded it up twice. The page's headline
   * claim is that its numbers match `scripts/run-fixtures.ts`, so a tenth of a
   * point of rounding drift is not cosmetic.
   */
  wordsCorrect: number;
  wordsTotal: number;
  wordAcc: number;
  sentence: number;
  cer: number;
}

/**
 * Score a subject's outputs against a dataset.
 *
 * Mirrors `scripts/_report.ts` exactly — micro-averaged word accuracy over all
 * reference words, sentence exact-match against the accepted alternatives,
 * mean CER — because the page cites our rows next to the CLI's and the two
 * must agree to the decimal. Cases with a null expectation are protection-only
 * fixtures and are excluded from accuracy, as they are there.
 */
function score(cases: readonly Fixture[], outputs: readonly string[]): Score {
  let wordsCorrect = 0;
  let wordsTotal = 0;
  let exact = 0;
  let cer = 0;
  let n = 0;

  cases.forEach((fixture, index) => {
    if (fixture.expected === null) return;
    const expected = normalize(fixture.expected);
    const got = normalize(outputs[index] ?? "");
    const accepted = [expected, ...fixture.alternatives.map((a) => normalize(a))];
    const words = wordAccuracy(expected, got);
    wordsCorrect += words.correct;
    wordsTotal += words.total;
    if (accepted.includes(got)) exact++;
    cer += characterErrorRate(expected, got);
    n++;
  });

  return {
    n,
    wordsCorrect,
    wordsTotal,
    wordAcc: wordsTotal ? wordsCorrect / wordsTotal : 0,
    sentence: n ? exact / n : 0,
    cer: n ? round4(cer / n) : 0,
  };
}

// ------------------------------------------------------------------ latency

/**
 * Mean ms per sentence over one pass of the gold set, on a freshly built engine.
 *
 * Not `scripts/bench.ts`'s warm-up-then-repeat pattern, which is right for a
 * latency *budget* and wrong for a comparison. Ours memoize per word, so timing
 * the same sentence 500 times measures the cache rather than the engine: it
 * reported 0.015 ms against elektito's 3.8 ms, a 250x lead that would evaporate
 * on any text the engine had not just converted. One pass over 1,906 distinct
 * sentences still rewards caching — words genuinely do recur across a document —
 * without paying the engine for answering the same question twice.
 */
function timeOverDataset(engine: Engine, cases: readonly Fixture[]): number {
  const started = performance.now();
  for (const testCase of cases) {
    try {
      engine.convert(testCase.input);
    } catch {
      /* a crash is a result; it is already counted in accuracy */
    }
  }
  return round4((performance.now() - started) / cases.length);
}

// -------------------------------------------------------------------- sizes

const gzip = (data: Uint8Array | string) => gzipSync(data, { level: 9 }).length;
const brotli = (data: Uint8Array) =>
  brotliCompressSync(data, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  }).length;

/** Bundle an entry point the way a consumer would and return its bytes. */
async function bundleBytes(entry: string): Promise<Uint8Array> {
  const result = await build({
    entryPoints: [new URL(entry, root).pathname],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0]!.contents;
}

function fileBytes(relative: string): Uint8Array | null {
  const path = new URL(relative, root);
  return existsSync(path) ? readFileSync(path) : null;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ------------------------------------------------------------------ subjects

interface SubjectSize {
  /** Uncompressed bytes as the implementation ships them. */
  raw: number;
  /** Gzip -9. The like-for-like column: every subject compressed the same way. */
  gzip: number | null;
  /** Ours only — what actually goes over the wire. */
  brotli?: number;
  breakdown?: Array<{ component: string; raw: number; gzip: number; brotli?: number }>;
  note?: string;
}

interface Subject {
  id: string;
  label: string;
  language: string;
  kind: "ours" | "third-party" | "baseline" | "reference";
  /** Whether it can run in a browser at all — the question the page is about. */
  runsInBrowser: boolean;
  /** False for subjects this script cannot install; those carry a citation. */
  measured: boolean;
  source: string;
  note: string;
  accuracy: Record<string, Score> | null;
  latencyMsPerSentence: number | null;
  size: SubjectSize | null;
  preservesProtectedSpans: boolean | null;
}

// ---------------------------------------------------------------------- run

const datasets = DATASETS.map((set) => {
  const cases = loadFixtures(set.file);
  return { ...set, cases, hash: sha256(readFileSync(new URL(set.file, root))) };
});

const subjects: Subject[] = [];

// -- ours, plus the floor -----------------------------------------------------

const assets = {
  weights: loadModel(),
  lexicon: loadLexicon(),
  frequency: loadFrequency(),
  bigram: loadBigram(),
  vowels: loadVowels(),
};

const ourEngines = buildOurEngines(assets);

// -- NeveshtYar ---------------------------------------------------------------

function readNeveshtYarSource(): string | null {
  const packageRoot = new URL("node_modules/farsi-smart-assistant/", root);
  const parts: string[] = [];
  for (const file of NEVESHTYAR_FILES) {
    const path = new URL(file, packageRoot);
    if (!existsSync(path)) return null;
    parts.push(readFileSync(path, "utf8"));
  }
  return parts.join("\n");
}

const neveshtyarSource = readNeveshtYarSource();

/**
 * Each subject paired with a way to rebuild it from scratch, because the
 * latency pass must start from a cold cache to mean anything.
 */
const liveEngines: Array<{ engine: Engine; fresh: () => Engine }> = [
  ...ourEngines.map((engine, index) => ({
    engine,
    fresh: () => buildOurEngines(assets)[index]!,
  })),
  { engine: naiveEngine(), fresh: naiveEngine },
  {
    engine: createNeveshtYarEngine(neveshtyarSource),
    fresh: () => createNeveshtYarEngine(neveshtyarSource),
  },
];

// -- measure every live engine ------------------------------------------------

const bundle = await bundleBytes("src/index.ts");
const naiveBundle = await bundleBytes("src/naive.ts");
const weightsFile = fileBytes("data/fixtures/weights.json");
const frequencyFile = fileBytes("data/lexicon/fa-frequency.bin");
const bigramFile = fileBytes("data/lexicon/fa-bigram.bin");
const vowelsFile = fileBytes("data/lexicon/fa-vowels.bin");
// The committed frequency artifact is already Brotli on disk. Gzipping it as-is
// would compare a compressed file against other subjects' raw ones, so it is
// expanded first and the same gzip -9 applied to everything.
const frequencyRaw = frequencyFile ? brotliDecompressSync(frequencyFile) : null;
const bigramRaw = bigramFile ? brotliDecompressSync(bigramFile) : null;
const vowelsRaw = vowelsFile ? brotliDecompressSync(vowelsFile) : null;

function ourSize(withModel: boolean, withFrequency: boolean): SubjectSize {
  const breakdown = [
    {
      component: "runtime + rules + tokenizer (JS)",
      raw: bundle.length,
      gzip: gzip(bundle),
      brotli: brotli(bundle),
    },
  ];
  if (withModel && weightsFile) {
    breakdown.push({
      component: "model weights (int6)",
      raw: weightsFile.length,
      gzip: gzip(weightsFile),
      brotli: brotli(weightsFile),
    });
  }
  if (withFrequency && frequencyRaw) {
    breakdown.push({
      component: "word frequency (25k words)",
      raw: frequencyRaw.length,
      gzip: gzip(frequencyRaw),
      brotli: brotli(frequencyRaw),
    });
  }
  // Loaded wherever frequency is (`buildOurEngines`), so counted with it.
  if (withFrequency && vowelsRaw) {
    breakdown.push({
      component: "vowels of confusable words (3.6k words)",
      raw: vowelsRaw.length,
      gzip: gzip(vowelsRaw),
      brotli: brotli(vowelsRaw),
    });
  }
  return {
    raw: breakdown.reduce((sum, r) => sum + r.raw, 0),
    gzip: breakdown.reduce((sum, r) => sum + r.gzip, 0),
    brotli: breakdown.reduce((sum, r) => sum + r.brotli!, 0),
    breakdown,
    note:
      "Excludes the lexicon, which is not shipped by default — see `optionalLexicon` " +
      "and `lexiconGain`, which measure exactly what leaving it out costs.",
  };
}

const OUR_SIZES: Record<string, SubjectSize> = {
  "ours-model-frequency": ourSize(true, true),
  "ours-rules-frequency": ourSize(false, true),
  "ours-rules": ourSize(false, false),
};

const goldCases = datasets.find((d) => d.id === "gold")!.cases;

for (const { engine, fresh } of liveEngines) {
  const accuracy: Record<string, Score> = {};
  if (engine.available) {
    for (const set of datasets) {
      accuracy[set.id] = score(
        set.cases,
        set.cases.map((c) => {
          try {
            return engine.convert(c.input);
          } catch {
            return "";
          }
        }),
      );
    }
  }

  let size: SubjectSize | null = OUR_SIZES[engine.id] ?? null;
  if (engine.id === "naive") {
    size = {
      raw: naiveBundle.length,
      gzip: gzip(naiveBundle),
      note: "The rule table it indexes, bundled alone. No model, no frequency table.",
    };
  }
  if (engine.id === "neveshtyar" && neveshtyarSource) {
    const files = NEVESHTYAR_FILES.map((file) => {
      const data = readFileSync(new URL(`node_modules/farsi-smart-assistant/${file}`, root));
      return { component: file, raw: data.length, gzip: gzip(data) };
    });
    // The three data files are the payload; the rest is engine code.
    const payload = files.filter((f) =>
      ["language_profiles.js", "lexical_priors.js", "finglish_source_model.js"].includes(f.component),
    );
    size = {
      raw: files.reduce((sum, f) => sum + f.raw, 0),
      gzip: files.reduce((sum, f) => sum + f.gzip, 0),
      breakdown: files,
      note:
        `Of which ${payload.reduce((s, f) => s + f.raw, 0)} raw bytes are statistical priors ` +
        `(language_profiles, lexical_priors, finglish_source_model).`,
    };
  }

  subjects.push({
    id: engine.id,
    label: engine.label,
    language: "JavaScript",
    kind: engine.kind,
    runsInBrowser: true,
    measured: engine.available,
    source:
      engine.kind === "third-party"
        ? "https://github.com/FarsioIR/NeveshtYar"
        : "this repository",
    note: engine.note,
    accuracy: engine.available ? accuracy : null,
    latencyMsPerSentence: engine.available ? timeOverDataset(fresh(), goldCases) : null,
      preservesProtectedSpans: engine.available ? preservesProtectedSpans(engine) : null,
    size,
  });
}

// -- what the lexicon is worth ------------------------------------------------

/**
 * The one number the size table cannot show on its own.
 *
 * Every accuracy figure this project reports — here, in the README and from
 * `scripts/run-fixtures.ts` — is measured with the 100k-stem lexicon loaded,
 * because `buildTransliterator` always loads it. The shipped byte count does
 * not include it, on the M2 finding that the model absorbs the vocabulary. Both
 * of those are defensible; stating them side by side without reconciling them
 * is not. So the same three configurations are re-scored with the lexicon
 * removed, and the difference is published next to the sizes.
 */
const lexiconGain = (() => {
  if (!assets.lexicon) return null;
  const without = buildOurEngines(assets, { lexicon: false });
  const rows: Record<string, { withLexicon: number; withoutLexicon: number; points: number }> = {};
  const goldSet = datasets.find((d) => d.id === "gold");
  if (!goldSet) return null;

  for (const engine of without) {
    if (!engine.available) continue;
    const bare = score(goldSet.cases, goldSet.cases.map((c) => engine.convert(c.input)));
    const full = subjects.find((s) => s.id === engine.id)?.accuracy?.gold;
    if (!full) continue;
    rows[engine.id] = {
      withLexicon: full.wordAcc,
      withoutLexicon: bare.wordAcc,
      points: round4((full.wordAcc - bare.wordAcc) * 100),
    };
  }
  return rows;
})();

/**
 * What sentence context is worth, and what it costs.
 *
 * The mirror of `lexiconGain`, for the opposite reason. The lexicon is absent
 * from the size column but present in every published accuracy figure; the
 * bigram is absent from both, because 73.6 KiB for +0.9 points of gold word
 * accuracy is 82 KiB per point against 8.9 for the frequency table. Publishing
 * the artifact and the gain without publishing that ratio would be the same
 * omission in the other direction.
 */
const bigramGain = (() => {
  if (!assets.bigram) return null;
  const withBigram = buildOurEngines(assets, { bigram: true });
  const goldSet = datasets.find((d) => d.id === "gold");
  if (!goldSet) return null;

  const rows: Record<string, { shipped: number; withBigram: number; points: number }> = {};
  for (const engine of withBigram) {
    if (!engine.available) continue;
    const better = score(goldSet.cases, goldSet.cases.map((c) => engine.convert(c.input)));
    const shipped = subjects.find((s) => s.id === engine.id)?.accuracy?.gold;
    if (!shipped) continue;
    rows[engine.id] = {
      shipped: shipped.wordAcc,
      withBigram: better.wordAcc,
      points: round4((better.wordAcc - shipped.wordAcc) * 100),
    };
  }
  return rows;
})();

const bigramOptional = bigramRaw
  ? {
      raw: bigramRaw.length,
      gzip: gzip(bigramRaw),
      brotli: bigramFile!.length,
      note:
        "Not counted in any subject's size above, and NOT loaded for the accuracy figures " +
        "above either — unlike the lexicon. `bigramGain` says what it buys and the ratio " +
        "is why it is opt-in: 82 KiB per point of gold word accuracy, against 8.9 for the " +
        "frequency table. Enable it with `node scripts/run-fixtures.ts --bigram`.",
    }
  : null;

const lexiconFile = fileBytes("data/lexicon/fa-stems.bin");
const lexiconRaw = lexiconFile ? brotliDecompressSync(lexiconFile) : null;
const optionalLexicon = lexiconRaw
  ? {
      raw: lexiconRaw.length,
      gzip: gzip(lexiconRaw),
      brotli: lexiconFile!.length,
      note:
        "Not counted in any subject's size above. Loaded for every accuracy figure this " +
        "project publishes. `lexiconGain` says what it buys on the gold set.",
    }
  : null;

// -- elektito/finglish, offline through the training venv ---------------------

interface ElektitoRun {
  available: boolean;
  reason?: string;
  version?: string;
  outputs?: string[];
  msPerCase?: number;
}

function runElektito(cases: readonly Fixture[]): ElektitoRun {
  const python = new URL("training/.venv/bin/python", root);
  if (!existsSync(python)) return { available: false, reason: "training/.venv is not set up" };
  try {
    const stdout = execFileSync(
      python.pathname,
      [new URL("scripts/compare-elektito.py", root).pathname],
      {
        input: cases.map((c) => JSON.stringify({ input: c.input })).join("\n"),
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    return JSON.parse(stdout) as ElektitoRun;
  } catch (error) {
    return { available: false, reason: (error as Error).message.slice(0, 200) };
  }
}

{
  const accuracy: Record<string, Score> = {};
  let available = false;
  let version: string | undefined;

  for (const set of datasets) {
    const run = runElektito(set.cases);
    if (!run.available || !run.outputs) continue;
    available = true;
    version = run.version;
    accuracy[set.id] = score(set.cases, run.outputs);
  }

  // Same definition as the live subjects: one pass over the gold set, mean ms
  // per sentence. Timed inside the Python process so interpreter startup and
  // the 7.1 MB table load are excluded — the reading most favourable to it.
  const latency = available ? runElektito(goldCases) : null;

  // Protection probe, through the same path the accuracy run uses.
  const probe = available
    ? runElektito([{ input: PROTECTION_PROBE } as Fixture])
    : null;

  const dataFiles = [
    "persian-word-freq.txt",
    "f2p-dict.txt",
    "f2p-beginning.txt",
    "f2p-middle.txt",
    "f2p-ending.txt",
    "f2p.py",
  ];
  const packageRoot = new URL(
    "training/.venv/lib/python3.12/site-packages/finglish/",
    root,
  );
  const breakdown = dataFiles
    .map((file) => {
      const path = new URL(file, packageRoot);
      if (!existsSync(path)) return null;
      const data = readFileSync(path);
      return { component: file, raw: data.length, gzip: gzip(data) };
    })
    .filter((row): row is { component: string; raw: number; gzip: number } => row !== null);

  subjects.push({
    id: "elektito-finglish",
    label: `elektito/finglish${version ? ` ${version}` : ""}`,
    language: "Python",
    kind: "third-party",
    runsInBrowser: false,
    measured: available,
    source: "https://github.com/elektito/finglish",
    note:
      "The reference implementation, and the one this project's API shape follows. " +
      "Cannot run in a browser: it is Python, and its ranking data is a 7.1 MB text file.",
    accuracy: available ? accuracy : null,
    latencyMsPerSentence: latency?.msPerCase ? round4(latency.msPerCase) : null,
    preservesProtectedSpans: probe?.outputs
      ? PROTECTED_SUBSTRINGS.every((needle) => probe.outputs![0]!.includes(needle))
      : null,
    size: breakdown.length
      ? {
          raw: breakdown.reduce((sum, f) => sum + f.raw, 0),
          gzip: breakdown.reduce((sum, f) => sum + f.gzip, 0),
          breakdown,
        }
      : null,
  });
}

// -- subjects that cannot be installed, carried as citations ------------------

const frequencyFileBytes =
  subjects
    .find((s) => s.id === "elektito-finglish")
    ?.size?.breakdown?.find((f) => f.component === "persian-word-freq.txt")?.raw ?? null;

subjects.push({
  id: "hctilg-finglish-php",
  label: "hctilg/finglish (PHP port)",
  language: "PHP",
  kind: "third-party",
  runsInBrowser: false,
  measured: false,
  source: "https://github.com/hctilg/finglish",
  note:
    "A direct port of elektito/finglish. Ships the same persian-word-freq.txt — verified " +
    "byte-identical, md5 68a189cf5907d7c7e80129aca832d4f7 — and its index.php opens with " +
    "ini_set('memory_limit', '2048M') to hold it. Not benchmarked: no PHP dependency here.",
  accuracy: null,
  latencyMsPerSentence: null,
  preservesProtectedSpans: null,
  size: frequencyFileBytes
    ? {
        raw: frequencyFileBytes,
        gzip: null,
        note: "Raw size carried over from the identical file measured above; not re-measured.",
      }
    : null,
});

subjects.push({
  id: "typersian",
  label: "typersian",
  language: "Python (desktop)",
  kind: "third-party",
  runsInBrowser: false,
  measured: false,
  source: "https://pypi.org/project/typersian/",
  note:
    "A desktop application with a proprietary ~22.8 MB model. Not benchmarked: the licence " +
    "does not permit redistribution and the figure below is the publisher's, not ours.",
  accuracy: null,
  latencyMsPerSentence: null,
  preservesProtectedSpans: null,
  size: { raw: 22_800_000, gzip: null, note: "Publisher's figure. Not measured here." },
});

// -- LLM references: a ceiling, not a comparable -------------------------------

/**
 * Frontier LLMs, zero-shot, on the same gold inputs. Their outputs were
 * produced in-session (Claude subagents; Codex GPT-5.6 luna in herdr panes),
 * seeing only the Finglish, with `data/provenance/prompts/zero-shot.md`, and
 * committed to `data/results/llm-reference.jsonl`. This script only scores
 * them, with the same `wordAccuracy`.
 *
 * They are context for how much of the gap is the task and how much is the
 * budget: a frontier model is on the order of 20,000 times the compute and
 * cannot run in a browser. `kind: "reference"` keeps them out of every
 * comparison between installable subjects.
 */
const referenceFile = new URL("data/results/llm-reference.jsonl", root);
if (existsSync(referenceFile)) {
  const byModel = new Map<string, Map<string, string>>();
  for (const line of readFileSync(referenceFile, "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as { model: string; id: string; output: string };
    const outputs = byModel.get(row.model) ?? new Map<string, string>();
    outputs.set(row.id, row.output);
    byModel.set(row.model, outputs);
  }
  const labels: Record<string, string> = {
    "claude-opus-5": "Claude Opus 5, zero-shot (reference)",
    "gpt-5.6-luna": "GPT-5.6 luna xhigh, zero-shot (reference)",
  };
  for (const [model, outputs] of byModel) {
    const gold = datasets.find((set) => set.id === "gold")!;
    const covered = gold.cases.filter((c) => outputs.has(c.id));
    subjects.push({
      id: `llm-${model}`,
      label: labels[model] ?? `${model}, zero-shot (reference)`,
      language: "LLM",
      kind: "reference",
      runsInBrowser: false,
      measured: true,
      source: "data/results/llm-reference.jsonl",
      note:
        `Not in-browser; on the order of 20,000x this project's compute. Scored on ${covered.length} of ` +
        `${gold.cases.length} gold rows it was run on, with the same wordAccuracy. Context for the ceiling, ` +
        "not a comparable.",
      accuracy: { gold: score(covered, covered.map((c) => outputs.get(c.id)!)) },
      latencyMsPerSentence: null,
      size: null,
      preservesProtectedSpans: null,
    });
  }
}

// -- context, explicitly not benchmarked --------------------------------------

const context = [
  {
    id: "google-input-tools",
    label: "Google Input Tools",
    what: "A network transliteration endpoint.",
    why:
      "Not a library and not benchmarked: it is a network call with no usage grant, so it " +
      "cannot be a dependency and its numbers cannot be reproduced from this repository. " +
      "Treat it as an accuracy ceiling that needs a server, not as a comparable.",
  },
  {
    id: "npm-wrong-direction",
    label: "pinglish, persian-to-pinglish, @pinooxhq/slug, f2f, fenglish",
    what: "npm packages whose names say Finglish.",
    why:
      "All convert Persian to Latin, for URL slugs — the opposite direction. Each was " +
      "checked against its published tarball. There is no npm package to compare against " +
      "because no npm package does this task.",
  },
];

const excluded = [
  {
    id: "persian-tools",
    label: "@persian-tools/persian-tools 4.0.4",
    why:
      "Grepped the published tarball: zero matches for finglish or pinglish. It does not " +
      "attempt this task. Scoring it at ~0% would be a strawman.",
  },
  {
    id: "farsityper",
    label: "farsityper 1.0.0",
    why:
      "Keyboard-layout remapping — turning QWERTY keystrokes into the Persian letters on " +
      "the same keys. A different problem, and likewise zero finglish matches in its tarball.",
  },
];

// ------------------------------------------------------------------- output

const payload = {
  $comment:
    "GENERATED by scripts/compare.ts. Do not edit by hand. Every figure with " +
    "\"measured\": true was produced by that script on the machine that ran it; the two " +
    "subjects marked false carry a citation and are rendered separately by the playground.",
  generated: new Date().toISOString().slice(0, 10),
  method: {
    metric:
      "word accuracy (word-level edit distance, ZWNJ folded to space) from src/metrics.ts, " +
      "applied identically to every subject",
    latency:
      "mean ms per sentence over one pass of the 1,906-pair gold set on a freshly built " +
      "engine, so a per-word cache is rewarded for real reuse but not for re-answering " +
      "the same sentence. Excludes process startup and data loading for every subject.",
    size:
      "gzip -9 over each subject's uncompressed shipping bytes, so the column is " +
      "like-for-like; ours additionally reports Brotli, which is what it actually serves",
    protection: `every subject given ${JSON.stringify(PROTECTION_PROBE)}; passes only if each protected span survives byte-identical`,
    neveshtyarAdapter:
      "NeveshtYar's Finglish intent guards on /^[a-z]+$/ over the whole input, so it " +
      "returns any multi-word text unchanged. It is fed one Latin run at a time, which is " +
      "how the extension works in a text field. Scoring it on whole sentences would " +
      "produce a 0% about the harness rather than the engine.",
  },
  optionalLexicon,
  lexiconGain,
  optionalBigram: bigramOptional,
  bigramGain,
  datasets: datasets.map((set) => ({
    id: set.id,
    label: set.label,
    n: set.cases.length,
    scored: set.cases.filter((c) => c.expected !== null).length,
    headline: set.headline,
    hash: set.hash,
  })),
  subjects,
  context,
  excluded,
};

mkdirSync(new URL("data/results", root), { recursive: true });
writeFileSync(
  new URL("data/results/comparison.json", root),
  `${JSON.stringify(payload, null, 2)}\n`,
);

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

console.log(`wrote data/results/comparison.json — ${subjects.length} subjects`);

if (PRINT) {
  const pct = (v: number | undefined) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
  const kib = (n: number | null | undefined) => (n ? `${(n / 1024).toFixed(1)} KiB` : "—");
  console.log("\n| subject | lang | browser | gold | fixtures | gzip | URL safe |");
  console.log("|---|---|---|---:|---:|---:|---|");
  for (const s of subjects) {
    console.log(
      `| ${s.label} | ${s.language} | ${s.runsInBrowser ? "yes" : "no"} | ` +
        `${pct(s.accuracy?.gold?.wordAcc)} | ${pct(s.accuracy?.fixtures?.wordAcc)} | ` +
        `${kib(s.size?.gzip)} | ${s.preservesProtectedSpans === null ? "—" : s.preservesProtectedSpans ? "yes" : "no"} |`,
    );
  }
}

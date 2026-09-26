/**
 * Size report — the plan's *secondary* budget.
 *
 * Soft cap ~250 KiB Brotli. Exceeding it requires a deliberate decision rather
 * than failing the build, because the dominant risk to adoption is a model too
 * small to spell common words correctly, not a download one JPEG larger. A
 * 100 KiB model that gets `sabr` wrong is abandoned faster than a 250 KiB one
 * that gets it right.
 *
 *     node scripts/size.ts [--json]
 */
import { build } from "esbuild";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";

const SOFT_CAP_BYTES = 250 * 1024;
const root = new URL("..", import.meta.url);

const brotli = (data: Uint8Array) =>
  brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  }).length;

const result = await build({
  entryPoints: [new URL("src/index.ts", root).pathname],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  write: false,
  legalComments: "none",
});
const code = result.outputFiles[0]!.contents;

interface Row { component: string; raw: number; gzip: number; brotli: number }
const rows: Row[] = [
  { component: "runtime + rules + tokenizer (JS)", raw: code.length, gzip: gzipSync(code).length, brotli: brotli(code) },
];

const weightsPath = new URL("data/fixtures/weights.json", root);
if (existsSync(weightsPath)) {
  const weights = readFileSync(weightsPath);
  const artifact = JSON.parse(weights.toString("utf8"));
  rows.push({
    component: `model weights (${artifact.quant})`,
    raw: weights.length, gzip: gzipSync(weights).length, brotli: brotli(weights),
  });
}

// Frequency is counted as shipped: it is worth +13 points to the rule
// baseline and +3.9 to the model, which is the best accuracy-per-byte in the
// project. The lexicon below is not — see the M2 decision.
const frequencyPath = new URL("data/lexicon/fa-frequency.bin", root);
if (existsSync(frequencyPath)) {
  const frequency = readFileSync(frequencyPath);
  rows.push({
    component: "word frequency (25k words + 566 chat words, pre-Brotli on disk)",
    raw: frequency.length, gzip: frequency.length, brotli: frequency.length,
  });
}

// Counted as shipped with the frequency table it indexes: 8.1 KiB, and the term
// it drives is worth +3.2 fixture points to the rule baseline and fixes `salam`.
const vowelsPath = new URL("data/lexicon/fa-vowels.bin", root);
if (existsSync(vowelsPath)) {
  const vowels = readFileSync(vowelsPath);
  rows.push({
    component: "vowels of confusable words (3.7k words, pre-Brotli on disk)",
    raw: vowels.length, gzip: vowels.length, brotli: vowels.length,
  });
}

const lexiconPath = new URL("data/lexicon/fa-stems.bin", root);
let lexiconRow: Row | null = null;
if (existsSync(lexiconPath)) {
  const lexicon = readFileSync(lexiconPath);
  // Already Brotli on disk; report it as-is rather than double-compressing.
  lexiconRow = { component: "lexicon (OPTIONAL, not shipped by default)", raw: lexicon.length, gzip: lexicon.length, brotli: lexicon.length };
}

/**
 * Optional artifacts: built, measured, documented, not in the shipped bytes.
 *
 * The lexicon is here on the M2 finding that the model absorbs the vocabulary.
 * The bigram is here on arithmetic: 73.6 KiB for +0.9 points of gold word
 * accuracy is 82 KiB per point, against 8.9 for the frequency table and a
 * negative return on the model weights. It is the worst accuracy-per-byte
 * artifact in the project, so the default does not pay for it and the headline
 * does not claim it.
 */
const optional: Row[] = [];
for (const [label, file] of [
  ["word bigrams, 30k pairs", "data/lexicon/fa-bigram.bin"],
  ["lexicon, 100,761 stems", "data/lexicon/fa-stems.bin"],
] as const) {
  const path = new URL(file, root);
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  // Already Brotli on disk; report as-is rather than double-compressing.
  optional.push({
    component: `${label} (OPTIONAL, not shipped by default)`,
    raw: bytes.length, gzip: bytes.length, brotli: bytes.length,
  });
}

const shipped = rows.reduce((sum, r) => sum + r.brotli, 0);
const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;

/**
 * What each published entry point costs on its own.
 *
 * The question a consumer actually asks is not "how big is tiny-finglish" but
 * "how big is the part I use". `"."` imports `Transducer` unconditionally —
 * the constructor builds one — so `"sideEffects": false` cannot let a bundler
 * drop the neural runtime for someone who never passes `model`. `./rules` is
 * that same pipeline with the seam left empty, which is why the two are
 * measured side by side rather than asserted to be close.
 */
async function tiers(): Promise<Array<{ entry: string; raw: number; gzip: number; brotli: number }>> {
  const out = [];
  for (const entry of ["src/index.ts", "src/rules-engine.ts", "src/normalize.ts"]) {
    const built = await build({
      entryPoints: [new URL(entry, root).pathname],
      bundle: true, minify: true, format: "esm", platform: "browser",
      target: "es2022", write: false, legalComments: "none",
    });
    const bytes = built.outputFiles[0]!.contents;
    out.push({ entry, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotli(bytes) });
  }
  return out;
}

if (process.argv.includes("--tiers")) {
  const SUBPATH: Record<string, string> = {
    "src/index.ts": "tiny-finglish",
    "src/rules-engine.ts": "tiny-finglish/rules",
    "src/normalize.ts": "tiny-finglish/normalize",
  };
  console.log("| entry | contents | raw | gzip | brotli |");
  console.log("|---|---|---:|---:|---:|");
  const NOTE: Record<string, string> = {
    "src/index.ts": "tokenizer, rules, beam, model runtime, sentence pass",
    "src/rules-engine.ts": "the same, without the model runtime",
    "src/normalize.ts": "Persian text normalization alone",
  };
  for (const t of await tiers()) {
    console.log(
      `| \`${SUBPATH[t.entry]}\` | ${NOTE[t.entry]} | ${kib(t.raw)} | ${kib(t.gzip)} | **${kib(t.brotli)}** |`,
    );
  }
  console.log("");
  console.log("Data artifacts are separate fetches and are never bundled by any entry:");
  for (const r of rows.slice(1)) console.log(`  ${r.component}  ${kib(r.brotli)}`);
  for (const r of optional) console.log(`  ${r.component}  ${kib(r.brotli)}`);
} else if (process.argv.includes("--json")) {
  const payload = {
    rows, lexicon: lexiconRow, optional, shippedBrotliBytes: shipped,
    softCapBytes: SOFT_CAP_BYTES, withinBudget: shipped <= SOFT_CAP_BYTES,
  };
  mkdirSync(new URL("dist", root), { recursive: true });
  writeFileSync(new URL("dist/size.json", root), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log("| component | raw | gzip | brotli |");
  console.log("|---|---:|---:|---:|");
  for (const r of rows) console.log(`| ${r.component} | ${kib(r.raw)} | ${kib(r.gzip)} | **${kib(r.brotli)}** |`);
  console.log(`| **shipped total** | | | **${kib(shipped)}** |`);
  for (const r of optional) console.log(`| ${r.component} | | | ${kib(r.brotli)} |`);
  console.log("");
  console.log(
    shipped <= SOFT_CAP_BYTES
      ? `within the ~${kib(SOFT_CAP_BYTES)} soft cap (${((shipped / SOFT_CAP_BYTES) * 100).toFixed(0)}% used)`
      : `OVER the ~${kib(SOFT_CAP_BYTES)} soft cap by ${kib(shipped - SOFT_CAP_BYTES)} — a deliberate decision, not an automatic failure`,
  );
}

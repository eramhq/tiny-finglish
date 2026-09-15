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
    component: "word frequency (25k words, pre-Brotli on disk)",
    raw: frequency.length, gzip: frequency.length, brotli: frequency.length,
  });
}

const lexiconPath = new URL("data/lexicon/fa-stems.bin", root);
let lexiconRow: Row | null = null;
if (existsSync(lexiconPath)) {
  const lexicon = readFileSync(lexiconPath);
  // Already Brotli on disk; report it as-is rather than double-compressing.
  lexiconRow = { component: "lexicon (OPTIONAL, not shipped by default)", raw: lexicon.length, gzip: lexicon.length, brotli: lexicon.length };
}

const shipped = rows.reduce((sum, r) => sum + r.brotli, 0);
const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;

if (process.argv.includes("--json")) {
  const payload = {
    rows, lexicon: lexiconRow, shippedBrotliBytes: shipped,
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
  if (lexiconRow) console.log(`| ${lexiconRow.component} | | | ${kib(lexiconRow.brotli)} |`);
  console.log("");
  console.log(
    shipped <= SOFT_CAP_BYTES
      ? `within the ~${kib(SOFT_CAP_BYTES)} soft cap (${((shipped / SOFT_CAP_BYTES) * 100).toFixed(0)}% used)`
      : `OVER the ~${kib(SOFT_CAP_BYTES)} soft cap by ${kib(shipped - SOFT_CAP_BYTES)} — a deliberate decision, not an automatic failure`,
  );
}

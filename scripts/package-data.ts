/**
 * Put the shipped data next to the compiled code, for the npm package:
 *
 *   dist/data/weights.json   the model (int6), as committed
 *   dist/data/frequency.bin  the word-frequency table
 *   dist/data/vowels.bin     the vowels of confusable words
 *
 * The committed tables are Brotli, which is right on disk and on the wire, but
 * a browser cannot undo Brotli from script (`DecompressionStream` has gzip and
 * deflate only). So they ship decompressed, the bytes `decodeFrequencyTable`
 * and `decodeVowelTable` read; a static host or CDN compresses them in transit,
 * as the playground's build does. The optional bigram and lexicon stay in the
 * repository. Run by `npm run build`.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const root = new URL("..", import.meta.url);
const out = new URL("dist/data/", root);
mkdirSync(out, { recursive: true });

copyFileSync(new URL("data/fixtures/weights.json", root), new URL("weights.json", out));
for (const [from, to] of [["fa-frequency.bin", "frequency.bin"], ["fa-vowels.bin", "vowels.bin"]] as const) {
  writeFileSync(new URL(to, out), brotliDecompressSync(readFileSync(new URL(`data/lexicon/${from}`, root))));
}
console.log("wrote dist/data: weights.json, frequency.bin, vowels.bin");

import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const LEXICON_ROUTE = "/lexicon.bin";
const FREQUENCY_ROUTE = "/frequency.bin";

/**
 * Serve the lexicon front-coded but *uncompressed*.
 *
 * The committed artifact is Brotli, which is the right thing to store and the
 * right thing to put on the wire — but browsers do not expose a Brotli
 * decompressor to script (`DecompressionStream` supports gzip and deflate
 * only). In production a static host sets `Content-Encoding: br` and the
 * browser decompresses transparently, so the page receives exactly these
 * bytes. This plugin reproduces that, rather than shipping a Brotli decoder in
 * the bundle to undo work HTTP already does.
 */
function lexiconPlugin(): Plugin {
  const load = () =>
    brotliDecompressSync(readFileSync(new URL("../data/lexicon/fa-stems.bin", import.meta.url)));
  const loadFrequency = () =>
    brotliDecompressSync(readFileSync(new URL("../data/lexicon/fa-frequency.bin", import.meta.url)));

  return {
    name: "tiny-finglish-lexicon",
    configureServer(server) {
      for (const [route, read] of [[LEXICON_ROUTE, load], [FREQUENCY_ROUTE, loadFrequency]] as const) {
        server.middlewares.use(route, (_request, response) => {
          response.setHeader("Content-Type", "application/octet-stream");
          response.setHeader("Cache-Control", "no-cache");
          response.end(read());
        });
      }
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "lexicon.bin", source: load() });
      this.emitFile({ type: "asset", fileName: "frequency.bin", source: loadFrequency() });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [lexiconPlugin()],
  server: {
    // src/ and data/ live above the playground root.
    fs: { allow: [repoRoot] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

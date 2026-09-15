import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { NEVESHTYAR_FILES } from "./src/engines.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const LEXICON_ROUTE = "/lexicon.bin";
const FREQUENCY_ROUTE = "/frequency.bin";
const BIGRAM_ROUTE = "/bigram.bin";
const NEVESHTYAR_ROUTE = "/vendor/neveshtyar.js";

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
  const loadBigram = () =>
    brotliDecompressSync(readFileSync(new URL("../data/lexicon/fa-bigram.bin", import.meta.url)));

  return {
    name: "tiny-finglish-lexicon",
    configureServer(server) {
      for (const [route, read] of [
        [LEXICON_ROUTE, load],
        [FREQUENCY_ROUTE, loadFrequency],
        [BIGRAM_ROUTE, loadBigram],
      ] as const) {
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
      this.emitFile({ type: "asset", fileName: "bigram.bin", source: loadBigram() });
    },
  };
}

/**
 * Serve NeveshtYar's runtime for the comparison panel.
 *
 * It is a browser extension, not a module: ten files that declare globals and
 * are loaded by a manifest. So it is concatenated and served as one text
 * resource, which the page evaluates in a function scope — see
 * `createNeveshtYarEngine`.
 *
 * It is served on its own route rather than imported so that the 3.5 MB is a
 * deliberate, visible fetch the reader opts into. Bundling it would hide the
 * number the comparison exists to show, and would put it in the page's initial
 * download for every visitor who never opens the tab.
 *
 * A missing devDependency is a 404, not a crash: the panel then renders the row
 * as unavailable, which is the honest state for a bare checkout.
 */
function neveshtyarPlugin(): Plugin {
  const packageRoot = new URL("../node_modules/farsi-smart-assistant/", import.meta.url);

  const read = (): Buffer | null => {
    const parts: Buffer[] = [];
    for (const file of NEVESHTYAR_FILES) {
      const path = new URL(file, packageRoot);
      if (!existsSync(path)) return null;
      parts.push(readFileSync(path), Buffer.from("\n"));
    }
    return Buffer.concat(parts);
  };

  return {
    name: "tiny-finglish-neveshtyar",
    configureServer(server) {
      server.middlewares.use(NEVESHTYAR_ROUTE, (_request, response) => {
        const source = read();
        if (!source) {
          response.statusCode = 404;
          response.end("farsi-smart-assistant is not installed");
          return;
        }
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.setHeader("Content-Length", String(source.length));
        response.setHeader("Cache-Control", "no-cache");
        response.end(source);
      });
    },
    generateBundle() {
      const source = read();
      if (source) {
        this.emitFile({ type: "asset", fileName: "vendor/neveshtyar.js", source });
      } else {
        this.warn("farsi-smart-assistant is not installed; the NeveshtYar row will be unavailable");
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [lexiconPlugin(), neveshtyarPlugin()],
  server: {
    // src/ and data/ live above the playground root.
    fs: { allow: [repoRoot] },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

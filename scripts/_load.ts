/** Shared loading helpers for the scripts. Not part of the published package. */
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { decodeFrontCoded } from "../src/frontcode.ts";
import { decodeBigramTable, type BigramTable } from "../src/bigram.ts";
import { decodeFrequencyTable, type FrequencyTable } from "../src/frequency.ts";
import { Transliterator } from "../src/index.ts";
import { decodeVowelTable, type VowelTable } from "../src/vowels.ts";
import type { WeightArtifact } from "../src/quant.ts";

const root = new URL("..", import.meta.url);

export const DEFAULT_WEIGHTS = "data/fixtures/weights.json";

export function loadLexicon(): Set<string> | undefined {
  const path = new URL("data/lexicon/fa-stems.bin", root);
  if (!existsSync(path)) return undefined;
  return new Set(decodeFrontCoded(brotliDecompressSync(readFileSync(path))));
}

export function loadFrequency(): FrequencyTable | undefined {
  const path = new URL("data/lexicon/fa-frequency.bin", root);
  if (!existsSync(path)) return undefined;
  return decodeFrequencyTable(brotliDecompressSync(readFileSync(path)));
}

export function loadBigram(): BigramTable | undefined {
  const path = new URL("data/lexicon/fa-bigram.bin", root);
  if (!existsSync(path)) return undefined;
  return decodeBigramTable(brotliDecompressSync(readFileSync(path)));
}

export function loadVowels(): VowelTable | undefined {
  const path = new URL("data/lexicon/fa-vowels.bin", root);
  if (!existsSync(path)) return undefined;
  return decodeVowelTable(brotliDecompressSync(readFileSync(path)));
}

/** The shipped weights by default; `file` (repo-relative) loads another candidate. */
export function loadModel(file = DEFAULT_WEIGHTS): WeightArtifact | undefined {
  const path = new URL(file, root);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as WeightArtifact;
}

export function buildTransliterator(
  options: {
    model?: boolean; frequency?: boolean; bigram?: boolean; hybrid?: boolean; vowels?: boolean;
    /** Repo-relative weights file; the shipped one by default. */
    weights?: string;
  } = {},
): Transliterator {
  const lexicon = loadLexicon();
  const model = options.model === false ? undefined : loadModel(options.weights);
  if (options.weights && options.model !== false && !model) throw new Error(`no weights at ${options.weights}`);
  const frequency = options.frequency === false ? undefined : loadFrequency();
  // Opt-in, unlike frequency. The bigram is the worst accuracy-per-byte
  // artifact in the project — 73.6 KiB for +0.9 points on gold, against 54.2
  // KiB for +6.1 from the frequency table — so it is not in the shipped
  // default and not in the headline. `--bigram` turns it on; `scripts/size.ts`
  // and `scripts/compare.ts` report what it buys.
  const bigram = options.bigram === true ? loadBigram() : undefined;
  // Rides with the frequency table: it only carries vowels for table words, and
  // at 8.1 KiB it is the cheapest point this project has bought. `--no-vowels`
  // is the ablation.
  const vowels = frequency && options.vowels !== false ? loadVowels() : undefined;
  return new Transliterator({
    ...(model ? { model } : {}),
    ...(lexicon ? { lexicon } : {}),
    ...(frequency ? { frequency } : {}),
    ...(bigram ? { bigram } : {}),
    ...(vowels ? { vowels } : {}),
    ...(options.hybrid ? { hybrid: true } : {}),
  });
}

export interface Fixture {
  id: string;
  category: string;
  input: string;
  expected: string | null;
  alternatives: string[];
  notes?: string;
  expectAction?: string;
  /** Dev set only: the reference minimally edited to what was actually typed. */
  faithful?: string;
  /** Chat sets: who typed the Finglish. `"llm"` throughout — the numbers are AI-typed. */
  typedBy?: string;
}

export function loadFixtures(file = "data/fixtures/fixtures.jsonl"): Fixture[] {
  return readFileSync(new URL(file, root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Fixture);
}

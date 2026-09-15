/** Shared loading helpers for the scripts. Not part of the published package. */
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { decodeFrontCoded } from "../src/frontcode.ts";
import { decodeFrequencyTable, type FrequencyTable } from "../src/frequency.ts";
import { Transliterator } from "../src/index.ts";
import type { WeightArtifact } from "../src/quant.ts";

const root = new URL("..", import.meta.url);

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

export function loadModel(): WeightArtifact | undefined {
  const path = new URL("data/fixtures/weights.json", root);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as WeightArtifact;
}

export function buildTransliterator(
  options: { model?: boolean; frequency?: boolean } = {},
): Transliterator {
  const lexicon = loadLexicon();
  const model = options.model === false ? undefined : loadModel();
  const frequency = options.frequency === false ? undefined : loadFrequency();
  return new Transliterator({
    ...(model ? { model } : {}),
    ...(lexicon ? { lexicon } : {}),
    ...(frequency ? { frequency } : {}),
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
}

export function loadFixtures(file = "data/fixtures/fixtures.jsonl"): Fixture[] {
  return readFileSync(new URL(file, root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Fixture);
}

/**
 * Re-estimate the noisy channel P(latin | Persian) from aligned word pairs.
 *
 *   node scripts/fit-channel.ts --pairs data/distill/llm-finglish.jsonl.br [--alpha 20] [--iterations 3] [--write]
 *
 * The channel in `src/dictionary.ts` is built from `src/rules.ts`: hand-set
 * entry priors, and `latinWeights` measured for a handful of letters on real
 * typing. This fits every (letter, position) distribution from data instead,
 * by hard EM: align every pair with the current channel's best path, count
 * which Latin spelling each Persian grapheme took, re-estimate, repeat.
 *
 * Counts are smoothed toward the table-derived distribution with `alpha`
 * pseudo-counts, so a letter seen ten times keeps most of its prior and a
 * letter seen ten thousand times is data. Spellings the table allows but the
 * data never used keep their prior share of `alpha`; spellings outside the
 * table are never invented, because the channel's alignment cannot produce one.
 *
 * `--write` writes `src/channel-fitted.ts`, generated and committed, which
 * `baseline.ts` loads when `SCORING.channel` is `"fitted"`. The pairs file is
 * the LLM-typed corpus from `build_distill.py` — never the dev set or gold, the
 * surfaces the fit is judged on.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Channel, type FittedChannel } from "../src/dictionary.ts";
import { SCORING } from "../src/baseline.ts";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const pairsFile = value("pairs") ?? "data/distill/llm-finglish.jsonl.br";
const alpha = Number(value("alpha") ?? 20);
const iterations = Number(value("iterations") ?? 3);
const personas = value("personas")?.split(",");

const ZWNJ = "‌";
const raw = readFileSync(pairsFile);
const text = pairsFile.endsWith(".br")
  ? brotliDecompressSync(raw).toString("utf8")
  : pairsFile.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
const pairs: Array<[string, string]> = [];
for (const line of text.split("\n")) {
  if (!line) continue;
  const row = JSON.parse(line) as { fa: string[]; finglish: string[]; persona: string };
  if (personas && !personas.includes(row.persona)) continue;
  row.fa.forEach((fa, k) => {
    // A detached affix (`mi konam`) is one Persian word; the channel sees it solid.
    const latin = row.finglish[k]!.replaceAll(" ", "");
    if (latin) pairs.push([latin, fa.replaceAll(ZWNJ, "")]);
  });
}

const params = { insertion: SCORING.insertion, gemination: SCORING.gemination };
const prior = new Channel(params).distributions();
let channel = new Channel(params);
let fitted: FittedChannel = prior;

for (let round = 1; round <= iterations; round++) {
  const emit: Record<string, Record<string, number>> = {};
  const insert: Record<string, Record<string, number>> = {};
  let aligned = 0;
  let logLik = 0;
  for (const [latin, fa] of pairs) {
    const path = channel.align(latin, fa);
    if (!path) continue;
    aligned++;
    logLik += channel.score(latin, fa);
    for (const step of path) {
      if (step.kind === "emit") {
        const key = `${step.fa}|${step.pos}`;
        (emit[key] ??= {})[step.latin] = (emit[key]![step.latin] ?? 0) + 1;
      } else if (step.kind === "insert") {
        (insert[step.pos] ??= {})[step.latin] = (insert[step.pos]![step.latin] ?? 0) + 1;
      }
    }
  }

  const smooth = (counts: Record<string, number> | undefined, base: Record<string, number>) => {
    const n = Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
    return Object.fromEntries(
      Object.entries(base).map(([latin, p]) => [latin, ((counts?.[latin] ?? 0) + alpha * p) / (n + alpha)]),
    );
  };
  fitted = {
    emissions: Object.fromEntries(Object.entries(prior.emissions).map(([key, base]) => [key, smooth(emit[key], base)])),
    // The insertion prior's own scale (`insertion`) stays tuned; only which
    // vowel letter is typed for an unwritten vowel is fitted.
    insertions: Object.fromEntries(Object.entries(prior.insertions).map(([pos, base]) => {
      const unscaled = Object.fromEntries(Object.entries(base).map(([l, p]) => [l, p / params.insertion]));
      return [pos, smooth(insert[pos], unscaled)];
    })),
  };
  channel = Channel.fromFitted(fitted, params);
  console.log(`round ${round}: ${aligned}/${pairs.length} pairs aligned, mean log-likelihood ${(logLik / aligned).toFixed(3)}`);
}

const show = ["ا|medial", "ا|final", "آ|initial", "و|medial", "ی|medial", "ه|final", "ق|initial", "خ|initial", "ع|medial", "ع|initial"];
for (const key of show) {
  const before = Object.entries(prior.emissions[key] ?? {}).map(([l, p]) => `${l || "∅"}=${p.toFixed(2)}`).join(" ");
  const after = Object.entries(fitted.emissions[key] ?? {}).map(([l, p]) => `${l || "∅"}=${p.toFixed(2)}`).join(" ");
  console.log(`${key.padEnd(10)} table: ${before}\n${"".padEnd(10)} fitted: ${after}`);
}

const jsonOut = value("json");
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(fitted));
  console.log(`wrote ${jsonOut}`);
}

if (argv.includes("--write")) {
  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const compact = (d: Record<string, Record<string, number>>) =>
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([l, p]) => [l, round4(p)]))]));
  writeFileSync(new URL("../src/channel-fitted.ts", import.meta.url),
    `/**\n * GENERATED by scripts/fit-channel.ts — do not edit.\n *\n * Source: ${pairsFile}${personas ? ` (personas ${personas.join(", ")})` : ""}, ` +
    `${pairs.length} word pairs, alpha ${alpha}, ${iterations} rounds of hard EM.\n */\n` +
    `import type { FittedChannel } from "./dictionary.ts";\n\n` +
    `export const FITTED_CHANNEL: FittedChannel = ${JSON.stringify({ emissions: compact(fitted.emissions), insertions: compact(fitted.insertions) })};\n`);
  console.log("wrote src/channel-fitted.ts");
}

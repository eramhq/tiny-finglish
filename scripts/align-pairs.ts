/**
 * Turn LLM-typed word pairs into transducer training examples.
 *
 *   node scripts/align-pairs.ts --pairs data/distill/llm-finglish.jsonl.br --out training/runs/llm/pairs.jsonl
 *
 * The transducer is a per-character tagger (`training/.../labels.py`): one
 * Persian label per Latin character. The synthetic corpus gets that alignment
 * free from its own generator; a pair typed by an LLM does not. Here the
 * noisy channel's forced alignment (`Channel.align` in `src/dictionary.ts`)
 * supplies it, and the labels are built exactly as `align_to_labels` builds
 * them: a Persian letter with no Latin (ع typed as nothing) is carried onto the
 * next character's label, and a multi-letter Latin unit labels its first
 * character.
 *
 * ZWNJ is not in the channel, so a word is aligned without it and the ZWNJ is
 * put back as a prefix on the label of the letter after it — `‌ک`, the label
 * form the synthetic corpus already uses.
 *
 * Pairs the channel cannot align are counted and dropped, never forced: a
 * failure is either a typo the channel has no path for or a mistyped word, and
 * neither is a label worth learning.
 *
 * Every word carries `final`, true on the last word of its typed line: the
 * clause-final position `endsClause` in `src/pipeline.ts` marks at runtime, where the model
 * sees an `<eos>` after the word (`training/.../data.py`). The artifact's words
 * had their punctuation stripped when they were sampled (`words_of` in
 * `build_distill.py`), so the end of the line is the only clause end it still
 * records; a mid-line comma is lost.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { SCORING } from "../src/baseline.ts";
import { Channel } from "../src/dictionary.ts";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const pairsFile = value("pairs") ?? "data/distill/llm-finglish.jsonl.br";
const out = value("out") ?? "training/runs/llm/pairs.jsonl";
const ZWNJ = "‌";

const channel = new Channel({ insertion: SCORING.insertion, gemination: SCORING.gemination });
const raw = readFileSync(pairsFile);
const text = pairsFile.endsWith(".br")
  ? brotliDecompressSync(raw).toString("utf8")
  : pairsFile.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");

const lines: string[] = [];
let total = 0;
let failed = 0;
let finals = 0;
for (const line of text.split("\n")) {
  if (!line) continue;
  const row = JSON.parse(line) as { id: string; fa: string[]; finglish: string[]; persona: string; worker: string };
  const last = row.fa.length - 1;
  row.fa.forEach((persian, k) => {
    const latin = row.finglish[k]!.replaceAll(" ", "").toLowerCase();
    if (!latin || !/^[a-z']+$/.test(latin)) return;
    total++;
    const solid = persian.replaceAll(ZWNJ, "");
    const path = channel.align(latin, solid);
    if (!path) {
      failed++;
      return;
    }
    // Build per-character labels over the ZWNJ-free word.
    const labels: string[] = [];
    let pending = "";
    for (const step of path) {
      if (step.latin === "") {
        pending += step.fa;
        continue;
      }
      labels.push(pending + step.fa);
      for (let c = 1; c < step.latin.length; c++) labels.push("");
      pending = "";
    }
    if (pending) {
      if (labels.length === 0) {
        failed++;
        return;
      }
      labels[labels.length - 1] += pending;
    }
    // Re-insert each ZWNJ before the letter that follows it.
    const zwnjBefore = new Set<number>();
    let letters = 0;
    for (const ch of persian) {
      if (ch === ZWNJ) zwnjBefore.add(letters);
      else letters++;
    }
    let consumed = 0;
    const withZwnj = labels.map((label) => {
      let rebuilt = "";
      for (const ch of label) {
        if (zwnjBefore.has(consumed)) rebuilt += ZWNJ;
        rebuilt += ch;
        consumed++;
      }
      return rebuilt;
    });
    if (withZwnj.join("") !== persian || withZwnj.length !== latin.length) {
      failed++;
      return;
    }
    lines.push(JSON.stringify({ latin, labels: withZwnj, persian, final: k === last,
      persona: row.persona, worker: row.worker, id: row.id }));
    if (k === last) finals++;
  });
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${lines.length} examples from ${total} pairs, ${finals} clause-final; ` +
  `${failed} unalignable (${((100 * failed) / total).toFixed(1)}%) -> ${out}`);

/**
 * Check that a surgery export differs from its source in the `<eos>` embedding
 * row only.
 *
 *   node scripts/verify-surgery.ts
 *   node scripts/verify-surgery.ts --a training/runs/v8-sentence/weights.json --b training/runs/v8-eos/weights.json
 *
 * `train.py --surgery-from … --train-only eos-row` trains nothing but that row,
 * so every word typed without the clause marker must compute exactly what the
 * source computed. The export quantizes per row (`export.py`), so a changed
 * row changes only its own codes and its own scale; anything else that differs
 * — another row, another tensor, the vocabularies, the config — means the
 * guarantee is gone, and this exits 1. The header may differ in one field,
 * `clauseMarker`, which `b` must carry.
 */
import { readFileSync } from "node:fs";
import type { WeightArtifact } from "../src/quant.ts";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const root = new URL("..", import.meta.url);
const pathA = value("a") ?? "training/runs/v8-sentence/weights.json";
const pathB = value("b") ?? "training/runs/v8-eos/weights.json";
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8")) as WeightArtifact;
const a = load(pathA);
const b = load(pathB);

const problems: string[] = [];
const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (key === "tensors" || key === "payload" || key === "clauseMarker") continue;
  if (!same(a[key as keyof WeightArtifact], b[key as keyof WeightArtifact])) problems.push(`header field ${key} differs`);
}
if (b.clauseMarker !== true) problems.push(`${pathB} does not carry clauseMarker: true`);

const eos = a.vocab.input.indexOf("<eos>");
if (eos < 0) problems.push("no <eos> in the input vocabulary");

/** Per-weight codes of one quantized payload, so rows can be sliced. */
function codes(payload: string, quant: string): ArrayLike<number> {
  if (quant === "int6") return Array.from(payload, (ch) => a.alphabet.indexOf(ch));
  return Buffer.from(payload, "base64");
}

let eosChanged = false;
if (a.tensors.length !== b.tensors.length) problems.push("tensor count differs");
a.tensors.forEach((ta, k) => {
  const tb = b.tensors[k];
  if (!tb || ta.name !== tb.name || !same(ta.shape, tb.shape) || ta.kind !== tb.kind) {
    problems.push(`tensor ${k} (${ta.name}) differs in name, shape or kind`);
    return;
  }
  if (ta.name !== "embed.weight") {
    if (!same(ta.scales, tb.scales)) problems.push(`${ta.name}: scales differ`);
    if (a.payload[k] !== b.payload[k]) problems.push(`${ta.name}: payload differs`);
    return;
  }
  // The embedding: one row per input symbol, `width` weights per row.
  const rows = ta.shape[0]!;
  const width = ta.shape[1]!;
  const ca = codes(a.payload[k]!, a.quant);
  const cb = codes(b.payload[k]!, b.quant);
  for (let r = 0; r < rows; r++) {
    let rowDiffers = ta.scales?.[r] !== tb.scales?.[r];
    for (let i = r * width; i < (r + 1) * width && !rowDiffers; i++) rowDiffers = ca[i] !== cb[i];
    if (!rowDiffers) continue;
    if (r === eos) eosChanged = true;
    else problems.push(`embed.weight row ${r} (${JSON.stringify(a.vocab.input[r])}) differs`);
  }
});

console.log(`a ${pathA}\nb ${pathB}`);
if (!eosChanged) console.log("note: the <eos> row is identical too; the surgery trained nothing");
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log(`surgery ok: only embed.weight row ${eos} (<eos>) differs`);

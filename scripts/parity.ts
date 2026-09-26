/**
 * Assert that `src/runtime.ts` reproduces PyTorch's logits.
 *
 * This is the check that keeps the browser honest. Without it a subtly wrong
 * reimplementation — a transposed weight, a scan run in the wrong direction, a
 * norm applied before the residual instead of after — shows up as a couple of
 * points of accuracy loss that look like ordinary model noise and get
 * rationalized away.
 *
 *     node scripts/parity.ts
 *     node scripts/parity.ts --weights training/runs/v8-eos/weights.json --fixtures training/runs/v8-eos/parity.jsonl
 *
 * Paths are repo-relative; the defaults are the shipped weights and fixtures.
 */
import { readFileSync, existsSync } from "node:fs";
import { decodeArtifact, type WeightArtifact } from "../src/quant.ts";
import { Transducer } from "../src/runtime.ts";

const argv = process.argv.slice(2);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const WEIGHTS = new URL(`../${value("weights") ?? "data/fixtures/weights.json"}`, import.meta.url);
const FIXTURES = new URL(`../${value("fixtures") ?? "data/fixtures/parity.jsonl"}`, import.meta.url);

/**
 * Tolerance on a single logit. The two implementations do the same arithmetic
 * in the same order in float32, so the only legitimate source of difference is
 * summation order inside BLAS versus our scalar loop. 2e-3 is roughly a
 * thousand times larger than that and still a thousand times smaller than the
 * gap between competing labels, so it catches structural bugs without flagging
 * float noise.
 */
const TOLERANCE = 2e-3;

if (!existsSync(WEIGHTS) || !existsSync(FIXTURES)) {
  console.error(
    "Parity fixtures are missing. Generate them with:\n" +
      "  cd training && .venv/bin/python -m tiny_finglish_training.parity \\\n" +
      "      --checkpoint runs/m2/100k/best.pt \\\n" +
      "      --weights ../data/fixtures/weights.json \\\n" +
      "      --out ../data/fixtures/parity.jsonl",
  );
  process.exit(1);
}

const artifact = JSON.parse(readFileSync(WEIGHTS, "utf8")) as WeightArtifact;
const model = new Transducer(decodeArtifact(artifact), artifact.config);
const labels = artifact.vocab.output;

interface ParityCase {
  input: string;
  ids: number[];
  shape: [number, number];
  logits: number[];
  predicted: string;
}

const cases = readFileSync(FIXTURES, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as ParityCase);

let worst = 0;
let worstCase = "";
let failures = 0;

for (const testCase of cases) {
  const logits = model.forward(Int32Array.from(testCase.ids));
  const [positions, labelCount] = testCase.shape;
  let maxDelta = 0;

  for (let i = 0; i < positions * labelCount; i++) {
    const delta = Math.abs(logits[i]! - testCase.logits[i]!);
    if (delta > maxDelta) maxDelta = delta;
  }

  let predicted = "";
  for (let t = 0; t < positions; t++) {
    let best = 0;
    for (let l = 1; l < labelCount; l++) {
      if (logits[t * labelCount + l]! > logits[t * labelCount + best]!) best = l;
    }
    predicted += labels[best]!;
  }

  const ok = maxDelta <= TOLERANCE && predicted === testCase.predicted;
  if (!ok) {
    failures++;
    console.error(
      `FAIL ${JSON.stringify(testCase.input)}  maxDelta=${maxDelta.toExponential(2)}  ` +
        `js=${JSON.stringify(predicted)}  py=${JSON.stringify(testCase.predicted)}`,
    );
  }
  if (maxDelta > worst) {
    worst = maxDelta;
    worstCase = testCase.input;
  }
}

console.log(`${cases.length} parity cases, quant=${artifact.quant}`);
console.log(`worst logit delta ${worst.toExponential(3)} on ${JSON.stringify(worstCase)} (tolerance ${TOLERANCE})`);
if (failures > 0) {
  console.error(`${failures} parity failure(s)`);
  process.exit(1);
}
console.log("parity ok");

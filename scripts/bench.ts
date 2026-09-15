/**
 * The latency budget — the plan's *primary* constraint, enforced here.
 *
 * The reasoning it rests on: a 250 KiB Brotli download is one medium JPEG,
 * paid once and then HTTP-cached, while a keystroke that misses a frame is
 * paid on every character forever. So size is a soft cap and latency is a hard
 * gate.
 *
 *   < 16 ms   incremental word path (one keystroke, one frame)
 *   < 100 ms  cold sentence
 *
 *     node scripts/bench.ts            # enforce
 *     node scripts/bench.ts --json     # machine-readable
 */
import { buildTransliterator } from "./_load.ts";

const KEYSTROKE_BUDGET_MS = 16;
const SENTENCE_BUDGET_MS = 100;

const SENTENCE = "salam, man emrooz ba doostam raftam daneshgah va baad az an be khane bargashtam";
const WORD = "daneshgah";

function measure(label: string, iterations: number, fn: () => void): { label: string; ms: number } {
  for (let i = 0; i < Math.min(iterations, 50); i++) fn(); // warm up the JIT
  const started = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return { label, ms: (performance.now() - started) / iterations };
}

const transliterator = buildTransliterator();
const results: Array<{ label: string; ms: number; budget?: number }> = [];

// Cold init: decoding the artifact and unpacking weights into Float32Arrays.
{
  const started = performance.now();
  buildTransliterator();
  results.push({ label: "cold init (decode + unpack weights)", ms: performance.now() - started });
}

// The typing path. Each keystroke extends the word being typed; conversion is
// word-by-word with unchanged words served from cache, so the cost per
// keystroke is one word, not one sentence.
{
  const prefixes = Array.from({ length: WORD.length }, (_, i) => WORD.slice(0, i + 1));
  let index = 0;
  const bench = measure("keystroke (incremental word)", 2000, () => {
    transliterator.transliterate(prefixes[index++ % prefixes.length]!);
  });
  results.push({ ...bench, budget: KEYSTROKE_BUDGET_MS });
}

// A keystroke at the end of an already-typed sentence: the realistic worst
// case for the typing path, since every earlier word must still be assembled.
{
  const bench = measure("keystroke (end of sentence, warm cache)", 500, () => {
    transliterator.transliterate(SENTENCE);
  });
  results.push({ ...bench, budget: KEYSTROKE_BUDGET_MS });
}

// Cold sentence: a fresh engine and an empty cache, which is what a user pasting
// text into a page actually experiences.
{
  const bench = measure("sentence (cold cache)", 100, () => {
    buildTransliterator().transliterate(SENTENCE);
  });
  results.push({ ...bench, budget: SENTENCE_BUDGET_MS });
}

{
  const paragraph = Array.from({ length: 8 }, () => SENTENCE).join(". ");
  results.push(measure("paragraph (~640 chars, warm)", 50, () => {
    transliterator.transliterate(paragraph);
  }));
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ results, budgets: { KEYSTROKE_BUDGET_MS, SENTENCE_BUDGET_MS } }, null, 2));
} else {
  console.log("| workload | ms | budget | |");
  console.log("|---|---:|---:|---|");
  for (const r of results) {
    const verdict = r.budget === undefined ? "" : r.ms <= r.budget ? "ok" : "**OVER**";
    console.log(`| ${r.label} | ${r.ms.toFixed(2)} | ${r.budget ?? "—"} | ${verdict} |`);
  }
}

const over = results.filter((r) => r.budget !== undefined && r.ms > r.budget);
if (over.length > 0) {
  console.error(`\n${over.length} workload(s) over budget:`);
  for (const r of over) console.error(`  ${r.label}: ${r.ms.toFixed(2)} ms > ${r.budget} ms`);
  process.exit(1);
}

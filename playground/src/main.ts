/**
 * The playground. Four panels:
 *
 *   Try it        one input, every candidate and the reason it was chosen
 *   Fixture suite all 175 committed fixtures run in-tab, failures shown in full
 *   Scaling curve the M2 result the shipped configuration was selected from
 *   Compare       this and every other implementation, side by side
 *
 * `PLAN.md`'s M1 exit condition is that a human can inspect every candidate and
 * its reason. The fixture panel exists so the page also answers the harder
 * question — not "can it do this one word" but "how often is it wrong, and on
 * what". The compare panel answers the one after that: how often is anything
 * else wrong, and what does it cost to be that good.
 */
import { Transliterator, decodeFrontCoded, normalize } from "../../src/index.ts";
import { decodeBigramTable, type BigramTable } from "../../src/bigram.ts";
import { decodeFrequencyTable, type FrequencyTable } from "../../src/frequency.ts";
import { wordAccuracy } from "../../src/metrics.ts";
import type { Span } from "../../src/index.ts";
import type { WeightArtifact } from "../../src/quant.ts";
import fixturesRaw from "../../data/fixtures/fixtures.jsonl?raw";
import goldRaw from "../../data/gold/gold.jsonl?raw";
import authoredRaw from "../../data/gold/authored.jsonl?raw";
import curve from "../../data/results/m2-curve.json";
import comparison from "../../data/results/comparison.json";
import {
  buildOurEngines,
  createNeveshtYarEngine,
  naiveEngine,
  PROTECTION_PROBE,
  type Engine,
} from "./engines.ts";

const LEXICON_URL = "/lexicon.bin";
const FREQUENCY_URL = "/frequency.bin";
const BIGRAM_URL = "/bigram.bin";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Fixture {
  id: string;
  category?: string;
  input: string;
  expected: string | null;
  alternatives: string[];
  notes?: string;
  expectAction?: string;
}

const parse = (raw: string): Fixture[] =>
  raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Fixture);
const FIXTURES = parse(fixturesRaw);
const GOLD = parse(goldRaw).map((f) => ({ ...f, category: "gold" }));
const AUTHORED = parse(authoredRaw).map((f) => ({ ...f, category: "authored" }));

let weights: WeightArtifact | undefined;
let lexicon: Set<string> | undefined;
let frequency: FrequencyTable | undefined;
let bigram: BigramTable | undefined;
let engine: Transliterator;

// ---------------------------------------------------------------- loading

async function loadAssets(): Promise<void> {
  try {
    const module = await import("../../data/fixtures/weights.json");
    weights = (module.default ?? module) as unknown as WeightArtifact;
  } catch {
    weights = undefined;
    for (const el of [$<HTMLInputElement>("use-model"), $<HTMLInputElement>("fx-model")]) {
      el.checked = false;
      el.disabled = true;
    }
  }
  try {
    const response = await fetch(LEXICON_URL);
    if (!response.ok) throw new Error(String(response.status));
    lexicon = new Set(decodeFrontCoded(new Uint8Array(await response.arrayBuffer())));
  } catch {
    lexicon = undefined;
    for (const el of [$<HTMLInputElement>("use-lexicon"), $<HTMLInputElement>("fx-lexicon")]) {
      el.checked = false;
      el.disabled = true;
    }
  }

  try {
    const response = await fetch(FREQUENCY_URL);
    if (!response.ok) throw new Error(String(response.status));
    frequency = decodeFrequencyTable(new Uint8Array(await response.arrayBuffer()));
  } catch {
    frequency = undefined;
  }

  try {
    const response = await fetch(BIGRAM_URL);
    if (!response.ok) throw new Error(String(response.status));
    bigram = decodeBigramTable(new Uint8Array(await response.arrayBuffer()));
  } catch {
    bigram = undefined;
  }

  const params = weights
    ? weights.tensors.reduce((sum, t) => sum + t.shape.reduce((a, b) => a * b, 1), 0)
    : 0;
  $("badge").textContent = weights
    ? `${params.toLocaleString()} params · ${weights.quant} · ${lexicon ? `${lexicon.size.toLocaleString()} stems` : "no lexicon"}${frequency ? ` · ${frequency.size.toLocaleString()} frequencies` : ""}${bigram ? " · 30k bigrams (opt-in)" : ""}`
    : "rule baseline only — no weights loaded";
}

/**
 * `ctx` is unchecked by default because the bigram is not in the shipped bytes.
 * The fixture panel must reproduce `scripts/run-fixtures.ts` exactly, and its
 * default there is off too — the toggle is the `--bigram` flag, the same way
 * the other two are `--rules` and `--no-frequency`.
 */
function build(model: boolean, lex: boolean, ctx = false, snap = false): Transliterator {
  return new Transliterator({
    ...(model && weights ? { model: weights } : {}),
    ...(lex && lexicon ? { lexicon } : {}),
    ...(lex && frequency ? { frequency } : {}),
    ...(ctx && bigram ? { bigram } : {}),
    useLexiconSnap: snap,
  });
}

// ------------------------------------------------------------- try panel

const EXAMPLES: Array<[string, string]> = [
  ["the plan's example", "salam, man emrooz miram Muscat"],
  ["etymological spelling", "sabr va sabz"],
  ["ZWNJ", "mikonam ketabha bozorgtar"],
  ["informal", "chetori? khoobi? nemidoonam"],
  ["protected spans", "in link https://example.ir/a?b=1 va ali@example.com ro bebin"],
  ["mixed English", "farda ba Google meeting daram"],
  ["numbers + code", "man 25 salame, API_KEY ro bede"],
  ["vowel length", "dar vs daar, bar vs baar"],
  ["a sentence", "in ketab ro az daneshgah gereftam"],
];

function renderExamples(): void {
  $("examples").replaceChildren(
    ...EXAMPLES.map(([label, text]) => {
      const button = document.createElement("button");
      button.className = "chip";
      button.textContent = label;
      button.title = text;
      button.addEventListener("click", () => {
        $<HTMLTextAreaElement>("input").value = text;
        renderTry();
      });
      return button;
    }),
  );
}

function rebuildTry(): void {
  engine = build(
    $<HTMLInputElement>("use-model").checked,
    $<HTMLInputElement>("use-lexicon").checked,
    $<HTMLInputElement>("use-bigram").checked,
    $<HTMLInputElement>("use-snap").checked,
  );
  renderTry();
}

function renderTry(): void {
  const input = $<HTMLTextAreaElement>("input").value;
  const started = performance.now();
  const result = engine.transliterate(input, {
    beamWidth: Number($<HTMLInputElement>("beam").value) || 8,
  });
  const elapsed = performance.now() - started;

  $("output").textContent = result.text;
  $("confidence").textContent = `confidence ${(result.confidence * 100).toFixed(1)}%`;
  $("timing").textContent = `${elapsed.toFixed(2)} ms`;
  $("engine").textContent = engine.hasModel ? "engine: model" : "engine: rules";

  $("alternatives").replaceChildren(
    ...(result.alternatives.length
      ? result.alternatives.map((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          return li;
        })
      : [hint("no alternatives — every span had a single candidate")]),
  );

  $("spans").replaceChildren(
    ...result.spans.filter((s) => s.action !== "space").map(renderSpan),
  );
}

function renderSpan(span: Span): HTMLElement {
  const box = el("div", "span");
  const head = el("div", "span-head");
  head.append(
    el("span", `tag ${span.action}`, span.copyReason ? `${span.action}:${span.copyReason}` : span.action),
    el("span", "src", JSON.stringify(span.input)),
    el("span", "reason", "→"),
    rtl(el("span", "dst", span.output)),
  );
  box.append(head);

  if (span.candidates?.length) {
    const list = el("ul", "cands");
    for (const candidate of span.candidates) {
      const row = el("li", "cand");
      const bar = el("span", "bar");
      bar.style.width = `${Math.max(candidate.probability * 100, 1)}%`;
      row.append(
        rtl(el("span", "out", candidate.output)),
        bar,
        el("span", "reason", `${(candidate.probability * 100).toFixed(1)}% · ${candidate.reason}`),
      );
      list.append(row);
    }
    box.append(list);
  }
  return box;
}

// --------------------------------------------------------- fixture panel

function runFixtures(): void {
  const choice = $<HTMLSelectElement>("fx-set").value;
  const set = choice === "gold" ? GOLD : choice === "authored" ? AUTHORED : FIXTURES;
  const runner = build(
    $<HTMLInputElement>("fx-model").checked,
    $<HTMLInputElement>("fx-lexicon").checked,
    $<HTMLInputElement>("fx-bigram").checked,
  );

  const buckets = new Map<string, { n: number; top1: number; top3: number; wc: number; wt: number }>();
  const failures: Array<{ fixture: Fixture; got: string; alts: string[]; spans: Span[] }> = [];
  let copyTotal = 0;
  let copyOk = 0;
  const started = performance.now();

  for (const fixture of set) {
    const result = runner.transliterate(fixture.input);
    for (const span of result.spans) {
      if (span.action !== "copy") continue;
      copyTotal++;
      if (span.output === span.input) copyOk++;
    }
    if (fixture.expected === null) continue;

    const accepted = [normalize(fixture.expected), ...fixture.alternatives.map((a) => normalize(a))];
    const got = normalize(result.text);
    const top1 = accepted.includes(got);
    const top3 = top1 || result.alternatives.some((a) => accepted.includes(normalize(a)));

    const words = wordAccuracy(accepted[0]!, got);
    const key = fixture.category ?? "gold";
    const bucket = buckets.get(key) ?? { n: 0, top1: 0, top3: 0, wc: 0, wt: 0 };
    bucket.n++;
    bucket.top1 += top1 ? 1 : 0;
    bucket.top3 += top3 ? 1 : 0;
    bucket.wc += words.correct;
    bucket.wt += words.total;
    buckets.set(key, bucket);

    if (!top1) failures.push({ fixture, got: result.text, alts: result.alternatives, spans: result.spans });
  }
  const elapsed = performance.now() - started;

  const total = [...buckets.values()].reduce(
    (acc, b) => ({ n: acc.n + b.n, top1: acc.top1 + b.top1, top3: acc.top3 + b.top3,
                   wc: acc.wc + b.wc, wt: acc.wt + b.wt }),
    { n: 0, top1: 0, top3: 0, wc: 0, wt: 0 },
  );
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");

  const table = el("table", "grid");
  table.innerHTML =
    "<thead><tr><th>category</th><th>n</th><th>word acc</th><th>sentence</th><th>top-3</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const [name, b] of [...buckets].sort((a, b) => b[1].n - a[1].n)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${b.n}</td><td>${pct(b.wc, b.wt)}</td>` +
                   `<td>${pct(b.top1, b.n)}</td><td>${pct(b.top3, b.n)}</td>`;
    body.append(tr);
  }
  const totalRow = document.createElement("tr");
  totalRow.className = "total";
  totalRow.innerHTML = `<td>all</td><td>${total.n}</td><td>${pct(total.wc, total.wt)}</td>` +
                       `<td>${pct(total.top1, total.n)}</td><td>${pct(total.top3, total.n)}</td>`;
  body.append(totalRow);
  table.append(body);

  const copyLine = el(
    "p",
    copyOk === copyTotal ? "ok" : "bad",
    `copy-span preservation ${pct(copyOk, copyTotal)} (${copyOk}/${copyTotal}) · ${set.length} cases in ${elapsed.toFixed(0)} ms`,
  );
  $("fx-summary").replaceChildren(table, copyLine);

  $("fx-failures").replaceChildren(
    ...(failures.length
      ? failures.map(renderFailure)
      : [hint("no failures — check that a set is actually loaded")]),
  );
}

function renderFailure(f: { fixture: Fixture; got: string; alts: string[]; spans: Span[] }): HTMLElement {
  const box = el("details", "fail");
  const summary = document.createElement("summary");
  summary.append(
    el("code", "", f.fixture.id),
    el("span", "src", JSON.stringify(f.fixture.input)),
  );
  box.append(summary);

  const grid = el("div", "fail-grid");
  grid.append(
    el("span", "reason", "expected"), rtl(el("span", "dst ok", f.fixture.expected ?? "")),
    el("span", "reason", "got"), rtl(el("span", "dst bad", f.got)),
  );
  if (f.alts.length) {
    grid.append(el("span", "reason", "alternatives"), rtl(el("span", "dst", f.alts.join("  ·  "))));
  }
  box.append(grid);

  for (const span of f.spans) {
    if (span.action !== "convert" || !span.candidates) continue;
    const line = el("div", "reason mono");
    line.append(`${JSON.stringify(span.input)} → `);
    span.candidates.forEach((c, i) => {
      if (i) line.append("   ");
      // <bdi> isolates each Persian run from the surrounding Latin. Without it
      // the bidi algorithm reorders "مرکی 100%" into "100 %مرکی" — the
      // percentage visually detaches from its number. W3C's guidance is to fix
      // this with markup rather than by injecting Unicode bidi controls into
      // the text, which is why the library itself emits none.
      const isolate = document.createElement("bdi");
      isolate.textContent = c.output;
      line.append(isolate, ` ${(c.probability * 100).toFixed(0)}% [${c.reason}] `);
    });
    box.append(line);
  }
  if (f.fixture.notes) box.append(el("p", "hint", f.fixture.notes));
  return box;
}

// --------------------------------------------------------- scaling panel

function renderCurve(): void {
  const sizes = curve.sizes as Array<Record<string, number | string>>;
  const table = el("table", "grid");
  table.innerHTML =
    "<thead><tr><th>size</th><th>params</th><th>word acc</th><th>int8</th><th>int6</th>" +
    "<th>+ lexicon</th><th>lexicon gain</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of sizes) {
    const tr = document.createElement("tr");
    if (row.name === curve.shipped.name) tr.className = "total";
    tr.innerHTML =
      `<td>${row.name}${row.name === curve.shipped.name ? " ★" : ""}</td>` +
      `<td>${Number(row.params).toLocaleString()}</td>` +
      `<td>${Number(row.test_word_accuracy).toFixed(4)}</td>` +
      `<td>${Number(row.test_word_accuracy_int8).toFixed(4)}</td>` +
      `<td>${Number(row.test_word_accuracy_int6).toFixed(4)}</td>` +
      `<td>${Number(row.test_word_accuracy_lexicon).toFixed(4)}</td>` +
      `<td>${Number(row.lexicon_gain) >= 0 ? "+" : ""}${Number(row.lexicon_gain).toFixed(4)}</td>`;
    body.append(tr);
  }
  table.append(body);

  const notes = el("div", "notes");
  notes.innerHTML = `
    <p><strong>★ shipped:</strong> ${curve.shipped.name} at ${curve.shipped.quant} —
       ${curve.shipped.reason}.</p>
    <p><strong>The lexicon gain shrinks monotonically</strong> (+5.1 → +4.2 → +3.1 points).
       That is the milestone's actual question: the model absorbs more of the vocabulary
       as it grows, so the lexicon does <em>not</em> ship at runtime. The snap tier is
       built and defaults to off — toggle it on the “Try it” tab to see what it would do.</p>
    <p><strong>Quantization is free</strong> at every size, so the choice is decided purely
       on bytes. int6 is ~30% smaller than int8 after Brotli.</p>
    <p class="bad"><strong>The caveat that outranks the table:</strong> these are synthetic
       numbers — held-out words from a corpus this project generated. On
       ${curve.evaluation.gold.n.toLocaleString()} pairs of <em>real human-typed</em> Finglish
       the same model scores
       <strong>${(curve.evaluation.gold.wordAcc * 100).toFixed(1)}%</strong>. Correcting the
       generator's spelling distribution did not move that
       (${(curve.generatorFix.before.gold * 100).toFixed(1)}% →
       ${(curve.generatorFix.after.gold * 100).toFixed(1)}%, both measured before the frequency
       table existed) while the same fix bought
       +${((curve.generatorFix.after.fixtures - curve.generatorFix.before.fixtures) * 100).toFixed(1)}
       points on the hand-authored fixtures. The corpus is not the bottleneck — the missing
       sentence-context model is.</p>
    <p class="bad"><strong>And the model is not beating the rules it replaced.</strong> On the
       same gold set the rule baseline with the same frequency table scores
       <strong>${(curve.evaluation.ruleBaseline.wordAcc * 100).toFixed(1)}%</strong> against the
       model's ${(curve.evaluation.gold.wordAcc * 100).toFixed(1)}%. The model only wins on
       fixtures and synthetic words, which is to say on text that resembles its training corpus.
       The Compare tab puts both against every other implementation that exists.</p>`;

  const ev = curve.evaluation;
  const pctOf = (v: number) => `${(v * 100).toFixed(1)}%`;
  const compare = el("table", "grid");
  compare.innerHTML =
    "<thead><tr><th>evaluation set</th><th>n</th><th>word acc</th><th>sentence</th><th>CER</th></tr></thead>" +
    `<tbody>
      <tr><td>synthetic held-out words</td><td>${ev.synthetic.n.toLocaleString()}</td>
          <td>${pctOf(ev.synthetic.wordAcc)}</td><td>—</td><td>—</td></tr>
      <tr><td>hand-authored fixtures</td><td>${ev.fixtures.n}</td>
          <td>${pctOf(ev.fixtures.wordAcc)}</td><td>${pctOf(ev.fixtures.sentence)}</td>
          <td>${ev.fixtures.cer.toFixed(3)}</td></tr>
      <tr class="total"><td><strong>real human Finglish</strong></td><td>${ev.gold.n.toLocaleString()}</td>
          <td><strong>${pctOf(ev.gold.wordAcc)}</strong></td><td>${pctOf(ev.gold.sentence)}</td>
          <td>${ev.gold.cer.toFixed(3)}</td></tr>
    </tbody>`;

  $("curve").replaceChildren(
    table, notes,
    el("h2", "", "Same model, three evaluation sets"),
    compare,
    el("p", "hint", `${curve.evaluation.gold.source}. Word accuracy is word-level edit distance with ZWNJ and punctuation folded to a space — the gold glues marks to words and we emit them as their own spans; sentence exact-match collapses to ~3% on 8-word sentences and stops discriminating. Quote the last row.`),
  );
}

// --------------------------------------------------------- compare panel

/**
 * The comparison panel.
 *
 * Two halves, and the second is the point. The first asks how this compares to
 * what else exists, and the answer is mostly that very little else exists —
 * nothing on npm does this task at all. The second runs our own configurations
 * against each other on real human Finglish, where the rule baseline beats the
 * neural model and a 2015 Python library beats both. A page that showed only
 * the first half would be marketing.
 *
 * Live subjects are converted in this tab and scored with the same
 * `wordAccuracy` the CLI uses. Everything else comes from
 * `data/results/comparison.json`, written by `scripts/compare.ts`, and is
 * labelled as such.
 */

type CmpScore = {
  n: number;
  wordsCorrect: number;
  wordsTotal: number;
  wordAcc: number;
  sentence: number;
  cer: number;
};

interface CmpSubject {
  id: string;
  label: string;
  language: string;
  kind: "ours" | "third-party" | "baseline" | "reference";
  runsInBrowser: boolean;
  measured: boolean;
  source: string;
  note: string;
  accuracy: Record<string, CmpScore> | null;
  latencyMsPerSentence: number | null;
  size: { raw: number; gzip: number | null; brotli?: number; note?: string } | null;
  preservesProtectedSpans: boolean | null;
}

const CMP = comparison as unknown as {
  generated: string;
  method: Record<string, string>;
  optionalLexicon: { raw: number; gzip: number; brotli: number; note: string } | null;
  lexiconGain: Record<string, { withLexicon: number; withoutLexicon: number; points: number }> | null;
  datasets: Array<{ id: string; label: string; n: number; scored: number; headline: boolean }>;
  subjects: CmpSubject[];
  context: Array<{ id: string; label: string; what: string; why: string }>;
  excluded: Array<{ id: string; label: string; why: string }>;
};

let cmpEngines: Engine[] = [];

function cmpInit(): void {
  if (cmpEngines.length) return;
  cmpEngines = [
    // No bigram: the comparison table prints a size next to every accuracy, and
    // the bigram is not in that size. `CMP.bigramGain` says what it would add.
    ...buildOurEngines({ weights, lexicon, frequency, bigram }, { bigram: false }),
    naiveEngine(),
    createNeveshtYarEngine(null),
  ];
  $("cmp-examples").replaceChildren(
    ...EXAMPLES.map(([label, text]) => {
      const button = el("button", "chip", label) as HTMLButtonElement;
      button.title = text;
      button.addEventListener("click", () => {
        $<HTMLTextAreaElement>("cmp-input").value = text;
        cmpRenderLive();
      });
      return button;
    }),
  );
  cmpRenderHeadline();
  cmpRenderLive();
  cmpRenderLandscape();
  cmpRenderSize();
  cmpRenderContext();
  cmpRunAccuracy();
}

/** The subject row from the committed JSON, for a live engine's id. */
function cmpRecord(id: string): CmpSubject | undefined {
  return CMP.subjects.find((s) => s.id === id);
}

function cmpRenderHeadline(): void {
  const best = (id: string) => cmpRecord(id)?.accuracy?.gold?.wordAcc ?? 0;
  const ours = best("ours-rules-frequency");
  const model = best("ours-model-frequency");
  const elektito = cmpRecord("elektito-finglish");
  const theirs = elektito?.accuracy?.gold?.wordAcc ?? 0;
  const ourGzip = cmpRecord("ours-model-frequency")?.size?.gzip ?? 1;
  const theirGzip = elektito?.size?.gzip ?? 0;

  const box = el("div", "notes");
  box.innerHTML = `
    <p><strong>Two findings this page exists to state plainly.</strong></p>
    <p><strong>1. Our rule baseline beats our neural model on real Finglish.</strong>
       ${pct(ours)} against ${pct(model)} word accuracy on the
       ${CMP.datasets.find((d) => d.id === "gold")?.n.toLocaleString()}-pair human gold set.
       The model wins on the hand-authored fixtures
       (${pct(cmpRecord("ours-model-frequency")?.accuracy?.fixtures?.wordAcc)} against
       ${pct(cmpRecord("ours-rules-frequency")?.accuracy?.fixtures?.wordAcc)}) — which mostly
       says the fixtures resemble the synthetic corpus it was trained on.</p>
    <p class="bad"><strong>2. A 2015 Python library still beats us on real Finglish.</strong>
       <code>elektito/finglish</code> scores ${pct(theirs)} where our best configuration scores
       ${pct(ours)}. It does it with a ${(theirGzip / 1024 / 1024).toFixed(1)} MiB gzipped
       frequency table — ${Math.round(theirGzip / ourGzip)}&times; our whole payload — it cannot
       run in a browser, and it destroys any URL you hand it. That is the trade this project
       makes, and it is a trade, not a win.</p>`;
  $("cmp-headline").replaceChildren(box);
}

// ------------------------------------------------------------- live field

function cmpRenderLive(): void {
  const input = $<HTMLTextAreaElement>("cmp-input").value;
  const rows = cmpEngines.map((engine) => {
    const row = el("div", `cmp-row ${engine.kind}`);
    const head = el("div", "cmp-row-head");
    head.append(
      el("span", `tag ${engine.kind}`, engine.kind),
      el("span", "cmp-label", engine.label),
    );
    row.append(head);

    if (!engine.available) {
      row.append(
        el(
          "p",
          "hint",
          engine.id === "neveshtyar"
            ? "Not loaded. Use the button below — it is a 3.6 MiB download, which is the point."
            : "Unavailable: its artifact did not load.",
        ),
      );
      return row;
    }

    const started = performance.now();
    let text: string;
    let confidence: number | null = null;
    try {
      if (engine.detail) {
        const result = engine.detail(input);
        text = result.text;
        confidence = result.confidence;
      } else {
        text = engine.convert(input);
      }
    } catch (error) {
      text = `— threw: ${(error as Error).message.slice(0, 80)}`;
    }
    const elapsed = performance.now() - started;

    row.append(rtl(el("div", "cmp-out", text)));
    row.append(
      el(
        "div",
        "reason",
        `${elapsed.toFixed(2)} ms` +
          (confidence === null ? "" : ` · confidence ${(confidence * 100).toFixed(1)}%`) +
          ` · ${engine.note}`,
      ),
    );
    return row;
  });
  $("cmp-live").replaceChildren(...rows);
}

// --------------------------------------------------------------- vendor

/**
 * Fetch NeveshtYar's runtime on demand.
 *
 * Kept behind a button rather than bundled: 3.6 MiB is the comparison's central
 * number and hiding it in the page's initial download would undercut the very
 * claim the row supports.
 */
async function cmpLoadVendor(): Promise<void> {
  const button = $<HTMLButtonElement>("cmp-load-vendor");
  button.disabled = true;
  button.textContent = "Loading NeveshtYar…";
  try {
    const response = await fetch("/vendor/neveshtyar.js");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    const engine = createNeveshtYarEngine(source);
    const index = cmpEngines.findIndex((e) => e.id === "neveshtyar");
    if (index >= 0) cmpEngines[index] = engine;
    const bytes = new TextEncoder().encode(source).length;
    button.textContent = engine.available
      ? `NeveshtYar loaded (${(bytes / 1024 / 1024).toFixed(2)} MiB)`
      : "NeveshtYar loaded but exposed no converter";
    cmpRenderLive();
    cmpRunAccuracy();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Load NeveshtYar (3.6 MiB)";
    $("cmp-live").append(
      hint(
        `NeveshtYar did not load (${(error as Error).message}). It installs as a pinned git ` +
          "devDependency; run npm install. The row stays unavailable, and its committed " +
          "figures are still in the tables below.",
      ),
    );
  }
}

// ------------------------------------------------------------- landscape

function cmpRenderLandscape(): void {
  const table = el("table", "grid");
  table.innerHTML =
    "<thead><tr><th>implementation</th><th>language</th><th>runs in a browser</th>" +
    "<th>data payload (gzip)</th><th>URL safe</th></tr></thead>";
  const body = document.createElement("tbody");

  for (const subject of CMP.subjects) {
    const tr = document.createElement("tr");
    if (subject.id === "ours-model-frequency") tr.className = "total";
    const size = subject.size?.gzip
      ? kib(subject.size.gzip)
      : subject.size
        ? `${(subject.size.raw / 1024 / 1024).toFixed(1)} MiB raw`
        : "—";
    tr.innerHTML =
      `<td>${escapeHtml(subject.label)}${subject.measured ? "" : ' <span class="tag offline">cited</span>'}</td>` +
      `<td>${escapeHtml(subject.language)}</td>` +
      `<td>${subject.runsInBrowser ? "yes" : "<strong>no</strong>"}</td>` +
      `<td>${size}</td>` +
      `<td>${subject.preservesProtectedSpans === null ? "—" : subject.preservesProtectedSpans ? '<span class="ok">yes</span>' : '<span class="bad">no</span>'}</td>`;
    body.append(tr);
  }
  table.append(body);

  const notes = el("div", "notes");
  notes.innerHTML = `
    <p><strong>&ldquo;URL safe&rdquo; is byte-identity, not resemblance.</strong> Each engine is
       given <code>${escapeHtml(PROTECTION_PROBE)}</code> and passes only if the URL and the
       email address come back unchanged. elektito turns the URL into Persian words;
       NeveshtYar quietly rewrites <code>https</code> to <code>http</code>. A link that arrives
       with one character changed is dead either way.</p>
    <p>Rows marked <span class="tag offline">cited</span> could not be installed here — a PHP
       port and a proprietary desktop app — so their figures come from their own sources and
       are not ours to vouch for. Everything else on this page was measured by
       <code>scripts/compare.ts</code> on ${CMP.generated}.</p>`;
  $("cmp-landscape").replaceChildren(table, notes);
}

// -------------------------------------------------------------- accuracy

function cmpRunAccuracy(): void {
  const setId = $<HTMLSelectElement>("cmp-set").value;
  const cases = setId === "gold" ? GOLD : setId === "authored" ? AUTHORED : FIXTURES;

  const rows: Array<{
    label: string;
    kind: string;
    live: boolean;
    n: number;
    wordAcc: number | null;
    sentence: number | null;
    cer: number | null;
    ms: number | null;
    note: string;
  }> = [];

  const started = performance.now();
  for (const engine of cmpEngines) {
    if (!engine.available) {
      const record = cmpRecord(engine.id);
      const score = record?.accuracy?.[setId];
      rows.push({
        label: engine.label,
        kind: engine.kind,
        live: false,
        n: score?.n ?? 0,
        wordAcc: score?.wordAcc ?? null,
        sentence: score?.sentence ?? null,
        cer: score?.cer ?? null,
        ms: record?.latencyMsPerSentence ?? null,
        note: score ? "from the committed run — not loaded in this tab" : "not loaded",
      });
      continue;
    }

    let wordsCorrect = 0;
    let wordsTotal = 0;
    let exact = 0;
    let n = 0;
    const engineStarted = performance.now();
    for (const fixture of cases) {
      if (fixture.expected === null) continue;
      let got: string;
      try {
        got = normalize(engine.convert(fixture.input));
      } catch {
        got = "";
      }
      const expected = normalize(fixture.expected);
      const accepted = [expected, ...fixture.alternatives.map((a) => normalize(a))];
      const words = wordAccuracy(expected, got);
      wordsCorrect += words.correct;
      wordsTotal += words.total;
      if (accepted.includes(got)) exact++;
      n++;
    }
    const engineMs = (performance.now() - engineStarted) / Math.max(n, 1);

    rows.push({
      label: engine.label,
      kind: engine.kind,
      live: true,
      n,
      // Divided here, from integer counts, and rounded exactly once. Rounding a
      // ratio before rendering it turned 56.4% into 56.5% the first time this
      // was written, which is precisely the drift the shared metric prevents.
      wordAcc: wordsTotal ? wordsCorrect / wordsTotal : 0,
      sentence: n ? exact / n : 0,
      cer: null,
      ms: engineMs,
      note: engine.note,
    });
  }

  // Subjects that cannot run in a browser at all, from the committed file.
  for (const subject of CMP.subjects) {
    if (cmpEngines.some((e) => e.id === subject.id)) continue;
    const score = subject.accuracy?.[setId];
    rows.push({
      label: subject.label,
      kind: subject.kind,
      live: false,
      n: score?.n ?? 0,
      wordAcc: score?.wordAcc ?? null,
      sentence: score?.sentence ?? null,
      cer: score?.cer ?? null,
      ms: subject.latencyMsPerSentence,
      note: subject.measured
        ? "measured offline by scripts/compare.ts — cannot run in a browser"
        : "cited, not measured here",
    });
  }

  const elapsed = performance.now() - started;
  const ranked = [...rows].sort((a, b) => (b.wordAcc ?? -1) - (a.wordAcc ?? -1));

  const table = el("table", "grid");
  table.innerHTML =
    "<thead><tr><th>subject</th><th></th><th>n</th><th>word acc</th><th>sentence</th>" +
    "<th>ms/sentence</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of ranked) {
    const tr = document.createElement("tr");
    if (row.kind === "ours") tr.className = "total";
    tr.innerHTML =
      `<td>${escapeHtml(row.label)}<div class="reason">${escapeHtml(row.note)}</div></td>` +
      `<td>${row.live ? '<span class="tag live">live</span>' : '<span class="tag offline">offline</span>'}</td>` +
      `<td>${row.n || "—"}</td>` +
      `<td><strong>${row.wordAcc === null ? "—" : pct(row.wordAcc)}</strong></td>` +
      `<td>${row.sentence === null ? "—" : pct(row.sentence)}</td>` +
      `<td>${row.ms === null ? "—" : row.ms.toFixed(2)}</td>`;
    body.append(tr);
  }
  table.append(body);

  const gain = CMP.lexiconGain?.["ours-rules-frequency"];
  const notes = el("div", "notes");
  notes.innerHTML = `
    <p class="hint">${cases.length.toLocaleString()} cases through
       ${cmpEngines.filter((e) => e.available).length} live engines in
       ${elapsed.toFixed(0)} ms. Our rows reproduce
       <code>node scripts/run-fixtures.ts</code> exactly — the three configurations are its
       default, <code>--rules</code>, and <code>--rules --no-frequency</code>.</p>
    ${
      gain
        ? `<p class="hint"><strong>One caveat on our own numbers.</strong> Every accuracy figure
           here is measured with the 100k-stem lexicon loaded, because the CLI always loads it —
           but the lexicon is <em>not</em> in the shipped byte count below. It is worth
           +${gain.points.toFixed(1)} points to the rules configuration on the gold set. Subtract
           it, or add ${kib(CMP.optionalLexicon?.gzip ?? 0)} to our size, but do not read the two
           columns as describing the same build.</p>`
        : ""
    }
    <p class="hint"><strong>How NeveshtYar is fed.</strong> ${escapeHtml(CMP.method.neveshtyarAdapter ?? "")}</p>`;

  $("cmp-accuracy").replaceChildren(table, notes);
}

// ------------------------------------------------------------------ size

function cmpRenderSize(): void {
  const table = el("table", "grid");
  table.innerHTML =
    "<thead><tr><th>subject</th><th>raw</th><th>gzip &minus;9</th><th>brotli</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const subject of CMP.subjects) {
    if (!subject.size) continue;
    const tr = document.createElement("tr");
    if (subject.kind === "ours") tr.className = "total";
    tr.innerHTML =
      `<td>${escapeHtml(subject.label)}${subject.measured ? "" : ' <span class="tag offline">cited</span>'}</td>` +
      `<td>${kib(subject.size.raw)}</td>` +
      `<td>${subject.size.gzip === null ? "—" : `<strong>${kib(subject.size.gzip)}</strong>`}</td>` +
      `<td>${subject.size.brotli ? kib(subject.size.brotli) : "—"}</td>`;
    body.append(tr);
  }
  if (CMP.optionalLexicon) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>lexicon (optional, not shipped)</td>" +
      `<td>${kib(CMP.optionalLexicon.raw)}</td><td>${kib(CMP.optionalLexicon.gzip)}</td>` +
      `<td>${kib(CMP.optionalLexicon.brotli)}</td>`;
    body.append(tr);
  }
  table.append(body);

  $("cmp-size").replaceChildren(
    table,
    hint(
      "Gzip is the like-for-like column: every subject's uncompressed shipping bytes through " +
        "gzip −9. Brotli is what we actually serve, and is only shown where it was measured.",
    ),
  );
}

// --------------------------------------------------------------- context

function cmpRenderContext(): void {
  const list = el("div", "notes");
  for (const item of CMP.context) {
    const block = el("div", "cmp-note");
    block.append(el("strong", "", item.label), el("p", "hint", `${item.what} ${item.why}`));
    list.append(block);
  }
  for (const item of CMP.excluded) {
    const block = el("div", "cmp-note");
    block.append(
      el("strong", "", `${item.label} — excluded`),
      el("p", "hint", item.why),
    );
    list.append(block);
  }
  $("cmp-context").replaceChildren(list);
}

// ------------------------------------------------------------------ util

function el(tag: string, className = "", text = ""): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function rtl(node: HTMLElement): HTMLElement {
  node.dir = "rtl";
  node.lang = "fa";
  return node;
}
function hint(text: string): HTMLElement {
  return el("p", "hint", text);
}
/** One rounding step, at the point of display. See `cmpRunAccuracy`. */
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}
/** Binary units throughout, matching `scripts/size.ts`. */
function kib(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}
/** Every string interpolated into an innerHTML table cell goes through this. */
function escapeHtml(text: string): string {
  const node = document.createElement("span");
  node.textContent = text;
  return node.innerHTML;
}

// ------------------------------------------------------------------ wire

for (const tab of document.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[role=tab]")) other.classList.remove("active");
    tab.classList.add("active");
    for (const panel of document.querySelectorAll<HTMLElement>(".tab-panel")) panel.hidden = true;
    $(`tab-${tab.dataset.tab}`).hidden = false;
    if (tab.dataset.tab === "fixtures" && !$("fx-summary").hasChildNodes()) runFixtures();
    // The compare panel runs three engines over the gold set on first open, so
    // it is built on demand rather than at load.
    if (tab.dataset.tab === "compare") cmpInit();
  });
}

$("input").addEventListener("input", renderTry);
for (const id of ["use-model", "use-lexicon", "use-bigram", "use-snap"]) {
  $(id).addEventListener("change", rebuildTry);
}
$("beam").addEventListener("change", renderTry);
$("fx-run").addEventListener("click", runFixtures);
for (const id of ["fx-model", "fx-lexicon", "fx-bigram", "fx-set"]) {
  $(id).addEventListener("change", runFixtures);
}

$("cmp-input").addEventListener("input", cmpRenderLive);
$("cmp-run").addEventListener("click", cmpRunAccuracy);
$("cmp-set").addEventListener("change", cmpRunAccuracy);
$("cmp-load-vendor").addEventListener("click", () => void cmpLoadVendor());

void loadAssets().then(() => {
  renderExamples();
  renderCurve();
  rebuildTry();
});

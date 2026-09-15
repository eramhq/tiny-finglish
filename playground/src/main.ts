/**
 * The playground. Three panels:
 *
 *   Try it        one input, every candidate and the reason it was chosen
 *   Fixture suite all 175 committed fixtures run in-tab, failures shown in full
 *   Scaling curve the M2 result the shipped configuration was selected from
 *
 * `PLAN.md`'s M1 exit condition is that a human can inspect every candidate and
 * its reason. The fixture panel exists so the page also answers the harder
 * question — not "can it do this one word" but "how often is it wrong, and on
 * what".
 */
import { Transliterator, decodeFrontCoded, normalize } from "../../src/index.ts";
import { wordAccuracy } from "../../src/metrics.ts";
import type { Span } from "../../src/index.ts";
import type { WeightArtifact } from "../../src/quant.ts";
import fixturesRaw from "../../data/fixtures/fixtures.jsonl?raw";
import goldRaw from "../../data/gold/gold.jsonl?raw";
import authoredRaw from "../../data/gold/authored.jsonl?raw";
import curve from "../../data/results/m2-curve.json";

const LEXICON_URL = "/lexicon.bin";
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

  const params = weights
    ? weights.tensors.reduce((sum, t) => sum + t.shape.reduce((a, b) => a * b, 1), 0)
    : 0;
  $("badge").textContent = weights
    ? `${params.toLocaleString()} params · ${weights.quant} · ${lexicon ? `${lexicon.size.toLocaleString()} stems` : "no lexicon"}`
    : "rule baseline only — no weights loaded";
}

function build(model: boolean, lex: boolean, snap = false): Transliterator {
  return new Transliterator({
    ...(model && weights ? { model: weights } : {}),
    ...(lex && lexicon ? { lexicon } : {}),
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
  const runner = build($<HTMLInputElement>("fx-model").checked, $<HTMLInputElement>("fx-lexicon").checked);

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
       <strong>${(curve.evaluation.gold.wordAcc * 100).toFixed(1)}%</strong>. Neither scaling
       the model nor correcting the generator's spelling distribution moved that number
       (${(curve.generatorFix.before.gold * 100).toFixed(1)}% →
       ${(curve.generatorFix.after.gold * 100).toFixed(1)}%), while the same fix bought
       +${((curve.generatorFix.after.fixtures - curve.generatorFix.before.fixtures) * 100).toFixed(1)}
       points on the hand-authored fixtures. The corpus is not the bottleneck — the missing
       sentence-context model is.</p>`;

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
    el("p", "hint", `${curve.evaluation.gold.source}. Word accuracy is word-level edit distance with ZWNJ folded to a space; sentence exact-match collapses to ~3% on 8-word sentences and stops discriminating. Quote the last row.`),
  );
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

// ------------------------------------------------------------------ wire

for (const tab of document.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[role=tab]")) other.classList.remove("active");
    tab.classList.add("active");
    for (const panel of document.querySelectorAll<HTMLElement>(".tab-panel")) panel.hidden = true;
    $(`tab-${tab.dataset.tab}`).hidden = false;
    if (tab.dataset.tab === "fixtures" && !$("fx-summary").hasChildNodes()) runFixtures();
  });
}

$("input").addEventListener("input", renderTry);
for (const id of ["use-model", "use-lexicon", "use-snap"]) $(id).addEventListener("change", rebuildTry);
$("beam").addEventListener("change", renderTry);
$("fx-run").addEventListener("click", runFixtures);
for (const id of ["fx-model", "fx-lexicon", "fx-set"]) $(id).addEventListener("change", runFixtures);

void loadAssets().then(() => {
  renderExamples();
  renderCurve();
  rebuildTry();
});

/**
 * The playground. Three panels:
 *
 *   Convert             type Finglish, see Persian; unsure words open their alternatives
 *   How accurate is it? the three setups scored in this tab on the evaluation sets
 *   What's inside       sizes, the steps, speed (static)
 *
 * The accuracy panel scores exactly as `scripts/run-fixtures.ts --no-lexicon`
 * does: the engines as the package ships them (frequency and vowels loaded,
 * the optional lexicon and bigrams off), the same `normalize`, and
 * `wordAccuracy` on the orthographic tier, the headline, or on the strict tier
 * when asked. So its numbers match the README's table.
 *
 * Data is fetched relative to the page (Vite's `base` is `./`), so the build
 * works from a subfolder such as a GitHub Pages project site.
 */
import { Transliterator, normalize } from "../../src/index.ts";
import { decodeBigramTable, type BigramTable } from "../../src/bigram.ts";
import { decodeFrequencyTable, type FrequencyTable } from "../../src/frequency.ts";
import { decodeVowelTable, type VowelTable } from "../../src/vowels.ts";
import { lenientSplitWords, orthographicWordAccuracy, splitWords, wordAccuracy } from "../../src/metrics.ts";
import type { Span } from "../../src/index.ts";
import type { WeightArtifact } from "../../src/quant.ts";
import goldRaw from "../../data/gold/gold.jsonl?raw";
import chatRaw from "../../data/chat/chat-dev.jsonl?raw";
import fixturesRaw from "../../data/fixtures/fixtures.jsonl?raw";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Setup = "rules" | "model" | "hybrid";
const SETUPS: readonly Setup[] = ["rules", "model", "hybrid"];
const SETUP_NAMES: Record<Setup, string> = {
  rules: "Rules only",
  model: "Model only",
  hybrid: "Both (best)",
};

/**
 * Compressed download per setup, from `node scripts/size.ts --tiers`: the
 * rules entry with frequency and vowels, the full entry plus the weights, and
 * the bigrams on top when sentence context is on.
 */
const DOWNLOAD_KIB: Record<Setup, number> = { rules: 87.4, model: 174.4, hybrid: 174.4 };
const BIGRAM_KIB = 73.6;

/** A converted word below this confidence is marked as unsure. */
const UNSURE_BELOW = 0.75;

interface Row {
  id: string;
  input: string;
  expected: string | null;
}

const parse = (raw: string): Row[] => raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row);
const SETS: Record<string, { rows: Row[]; note: string }> = {
  gold: {
    rows: parse(goldRaw),
    note: "Real Finglish typed by people, never used to tune the engine.",
  },
  chat: {
    rows: parse(chatRaw),
    note: "Short chat messages written and typed by AI models, so the numbers are optimistic.",
  },
  fixtures: {
    rows: parse(fixturesRaw),
    note: "Mostly single words and short phrases chosen to be tricky: half-spaces, homophones, links, mixed English.",
  },
};

// ---------------------------------------------------------------- assets

let weights: WeightArtifact | undefined;
let frequency: FrequencyTable | undefined;
let vowels: VowelTable | undefined;
let bigram: BigramTable | undefined;

async function fetchBinary(url: string): Promise<Uint8Array | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function loadAssets(): Promise<void> {
  try {
    const module = await import("../../data/fixtures/weights.json");
    weights = (module.default ?? module) as unknown as WeightArtifact;
  } catch {
    weights = undefined;
  }
  const [freq, vow, bi] = await Promise.all(
    ["frequency.bin", "vowels.bin", "bigram.bin"].map((name) => fetchBinary(`${import.meta.env.BASE_URL}${name}`)),
  );
  frequency = freq ? decodeFrequencyTable(freq) : undefined;
  vowels = vow && frequency ? decodeVowelTable(vow) : undefined;
  bigram = bi ? decodeBigramTable(bi) : undefined;

  if (!weights) {
    for (const input of document.querySelectorAll<HTMLInputElement>("input[name=setup]")) {
      if (input.value !== "rules") input.disabled = true;
      input.checked = input.value === "rules";
    }
  }
  if (!bigram) $<HTMLInputElement>("context").disabled = true;
}

const engines = new Map<string, Transliterator>();

/** One engine per setup, built once. Matches `buildTransliterator({ lexicon: false })` in `scripts/_load.ts`. */
function engineFor(setup: Setup, context = false): Transliterator {
  const key = `${setup}${context ? "+context" : ""}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = new Transliterator({
      ...(setup !== "rules" && weights ? { model: weights, hybrid: setup === "hybrid" } : {}),
      ...(frequency ? { frequency } : {}),
      ...(vowels ? { vowels } : {}),
      ...(context && bigram ? { bigram } : {}),
    });
    engines.set(key, engine);
  }
  return engine;
}

// ---------------------------------------------------------------- convert

const EXAMPLES: Array<[string, string]> = [
  ["A greeting", "salam, chetori? khoobi?"],
  ["Everyday chat", "fardaa miam khoonatoon, ok?"],
  ["Half-spaces", "mikonam, ketabha, bozorgtar"],
  ["With a link", "in link ro bebin https://example.ir va be ali@example.com email bede"],
  ["Mixed English", "farda ba Google meeting daram"],
  ["A longer sentence", "in ketab ro az ketabkhooneye daneshgah gereftam"],
];

/** Alternatives the reader chose, keyed by where the word sits and what was typed there. */
const chosen = new Map<string, string>();
const spanKey = (span: Span) => `${span.start}:${span.input}`;

function currentSetup(): Setup {
  return (document.querySelector<HTMLInputElement>("input[name=setup]:checked")?.value ?? "hybrid") as Setup;
}

function renderExamples(): void {
  $("examples").replaceChildren(
    ...EXAMPLES.map(([label, text]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = label;
      button.title = text;
      button.addEventListener("click", () => {
        const input = $<HTMLTextAreaElement>("input");
        input.value = text;
        input.focus();
        convert();
      });
      return button;
    }),
  );
}

function convert(): void {
  closePopover();
  const setup = currentSetup();
  const context = $<HTMLInputElement>("context").checked;
  const engine = engineFor(setup, context);
  const text = $<HTMLTextAreaElement>("input").value;

  const started = performance.now();
  const result = engine.transliterate(text);
  const elapsed = performance.now() - started;

  // Forget choices for words that are no longer there as typed.
  const present = new Set(result.spans.map(spanKey));
  for (const key of chosen.keys()) if (!present.has(key)) chosen.delete(key);

  const output = $("output");
  output.replaceChildren(...result.spans.map(renderSpan));
  if (!text.trim()) output.replaceChildren(placeholder("Persian appears here as you type."));
  $("legend-unsure").hidden = !output.querySelector(".unsure");
  $("legend-kept").hidden = !output.querySelector(".kept");

  const size = DOWNLOAD_KIB[setup] + (context ? BIGRAM_KIB : 0);
  $("facts").replaceChildren(
    fact(`${elapsed < 1 ? elapsed.toFixed(2) : elapsed.toFixed(0)} ms to convert`),
    fact(`${Math.round(size)} KiB to download${setup === "rules" ? "" : " (model only and both use the same files)"}`),
  );
}

function renderSpan(span: Span, index: number): Node {
  if (span.action === "space") return document.createTextNode(span.output);
  if (span.action !== "convert") {
    // A link or an English word is left-to-right inside a right-to-left line.
    // <bdi> isolates it, so it cannot pull the Persian words beside it into
    // its direction.
    const kept = document.createElement(span.action === "copy" ? "bdi" : "span");
    kept.className = span.action === "copy" ? "kept" : "mark";
    kept.textContent = span.output;
    if (span.action === "copy") kept.title = "Kept as typed";
    return kept;
  }
  const choice = chosen.get(spanKey(span));
  const word = choice ?? span.output;
  const alternatives = (span.candidates ?? []).filter((c) => c.output && c.output !== span.output);
  const unsure = !choice && span.confidence < UNSURE_BELOW && alternatives.length > 0;
  if (!span.output) return document.createTextNode("");

  // A <span> with a button role, not a <button>: a <button> is an atomic
  // inline, which the bidi algorithm treats as a neutral, so two Persian words
  // between a link and an email came out left-to-right (به و for و به).
  const button = document.createElement("span");
  button.setAttribute("role", "button");
  button.tabIndex = 0;
  button.className = `word${unsure ? " unsure" : ""}${choice ? " changed" : ""}`;
  button.textContent = word;
  button.dataset.index = String(index);
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-label", `${word}, typed as ${span.input}${unsure ? ", unsure" : ""}`);
  button.addEventListener("click", () => openPopover(button, span));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPopover(button, span);
  });
  return button;
}

function openPopover(anchor: HTMLElement, span: Span): void {
  const popover = $("popover");
  const current = chosen.get(spanKey(span)) ?? span.output;
  const options = (span.candidates ?? []).filter((c) => c.output);

  const heading = document.createElement("p");
  heading.className = "popover-head";
  heading.append("You typed ");
  const typed = document.createElement("strong");
  typed.dir = "ltr";
  typed.textContent = span.input;
  heading.append(typed);

  const list = document.createElement("div");
  list.className = "choices";
  for (const candidate of options) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = `choice${candidate.output === current ? " current" : ""}`;
    choice.setAttribute("aria-pressed", String(candidate.output === current));
    const label = document.createElement("span");
    label.className = "choice-word";
    label.lang = "fa";
    label.textContent = candidate.output;
    const bar = document.createElement("span");
    bar.className = "choice-bar";
    bar.style.setProperty("--p", String(Math.max(candidate.probability, 0.02)));
    const share = document.createElement("span");
    share.className = "choice-share";
    share.dir = "ltr";
    share.textContent = `${Math.round(candidate.probability * 100)}%`;
    choice.append(label, bar, share);
    choice.addEventListener("click", () => {
      if (candidate.output === span.output) chosen.delete(spanKey(span));
      else chosen.set(spanKey(span), candidate.output);
      convert();
      document.querySelector<HTMLElement>(`.word[data-index="${anchor.dataset.index}"]`)?.focus();
    });
    list.append(choice);
  }
  const note = document.createElement("p");
  note.className = "popover-note";
  note.textContent = "How likely the engine thinks each spelling is.";
  popover.replaceChildren(heading, list, note);

  const stage = popover.parentElement!.getBoundingClientRect();
  const box = anchor.getBoundingClientRect();
  popover.hidden = false;
  const width = popover.offsetWidth;
  const left = Math.min(Math.max(box.left + box.width / 2 - stage.left - width / 2, 0), stage.width - width);
  popover.style.left = `${left}px`;
  popover.style.top = `${box.bottom - stage.top + 8}px`;
  popover.querySelector<HTMLButtonElement>(".choice.current, .choice")?.focus();
  popover.dataset.anchor = anchor.dataset.index ?? "";
}

function closePopover(returnFocus = false): void {
  const popover = $("popover");
  if (popover.hidden) return;
  const anchor = popover.dataset.anchor;
  popover.hidden = true;
  if (returnFocus && anchor) document.querySelector<HTMLElement>(`.word[data-index="${anchor}"]`)?.focus();
}

async function copyOutput(): Promise<void> {
  const text = $("output").textContent ?? "";
  const button = $<HTMLButtonElement>("copy");
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select the text to copy";
  }
  setTimeout(() => (button.textContent = "Copy"), 1500);
}

// ---------------------------------------------------------------- accuracy

interface Scored {
  row: Row;
  got: string;
  /** Words right on the headline (orthographic) tier and on strict. */
  fair: { correct: number; total: number };
  strict: { correct: number; total: number };
}

/** The tier the panel is showing. */
const tierOf = (s: Scored) => ($<HTMLInputElement>("strict").checked ? s.strict : s.fair);

const results = new Map<string, Map<Setup, Scored[]>>();
let shownMistakes = 0;
let running = false;

async function runAccuracy(): Promise<void> {
  if (running) return;
  const setName = $<HTMLSelectElement>("set").value;
  const key = setName;
  $("set-note").textContent = SETS[setName]!.note;

  if (!results.has(key)) {
    running = true;
    const rows = SETS[setName]!.rows.filter((r) => r.expected !== null);
    const setups = SETUPS.filter((s) => s === "rules" || weights);
    const progress = $("progress");
    const bar = progress.firstElementChild as HTMLElement;
    progress.hidden = false;
    const bySetup = new Map<Setup, Scored[]>();
    const steps = rows.length * setups.length;
    let done = 0;
    for (const setup of setups) {
      const engine = engineFor(setup);
      const scored: Scored[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const got = normalize(engine.transliterate(row.input).text);
        const expected = normalize(row.expected!);
        // The same calls as `scripts/_report.ts`, so the numbers match the README's.
        scored.push({ row, got, fair: orthographicWordAccuracy(expected, got), strict: wordAccuracy(expected, got) });
        if (++done % 40 === 0) {
          bar.style.width = `${(100 * done) / steps}%`;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      bySetup.set(setup, scored);
    }
    progress.hidden = true;
    results.set(key, bySetup);
    running = false;
  }
  renderScores(results.get(key)!);
  shownMistakes = 0;
  $("mistakes").replaceChildren();
  showMistakes();
}

function renderScores(bySetup: Map<Setup, Scored[]>): void {
  const best = Math.max(...[...bySetup.values()].map(accuracy));
  const rows = [...bySetup].map(([setup, scored]) => {
    const value = accuracy(scored);
    const row = document.createElement("div");
    row.className = `score${value === best ? " best" : ""}`;
    const name = document.createElement("span");
    name.className = "score-name";
    name.textContent = SETUP_NAMES[setup];
    const track = document.createElement("span");
    track.className = "score-track";
    const fill = document.createElement("span");
    fill.className = "score-fill";
    fill.style.setProperty("--v", String(value));
    track.append(fill);
    const number = document.createElement("span");
    number.className = "score-value";
    number.textContent = `${(value * 100).toFixed(1)}%`;
    row.append(name, track, number);
    return row;
  });
  const words = [...bySetup.values()][0]!.reduce((n, s) => n + tierOf(s).total, 0);
  const axis = document.createElement("div");
  axis.className = "score axis";
  axis.setAttribute("aria-hidden", "true");
  axis.innerHTML = "<span></span><span class=\"axis-labels\"><span>50%</span><span>100%</span></span><span></span>";
  const caption = document.createElement("p");
  caption.className = "muted small";
  caption.textContent = `Share of ${words.toLocaleString()} words written the way the person wrote them.`;
  $("scores").replaceChildren(...rows, axis, caption);
}

function accuracy(scored: Scored[]): number {
  const total = scored.reduce((n, s) => n + tierOf(s).total, 0);
  return total ? scored.reduce((n, s) => n + tierOf(s).correct, 0) / total : 0;
}

function showMistakes(): void {
  const setName = $<HTMLSelectElement>("set").value;
  const strict = $<HTMLInputElement>("strict").checked;
  const bySetup = results.get(setName);
  const setup = $<HTMLSelectElement>("mistakes-of").value as Setup;
  const scored = bySetup?.get(setup);
  const container = $("mistakes");
  if (!scored) {
    container.replaceChildren(placeholder("Run a test set to see mistakes."));
    return;
  }
  const mistakes = scored.filter((s) => tierOf(s).correct < tierOf(s).total);
  if (!mistakes.length) {
    container.replaceChildren(placeholder("No mistakes on this set."));
    $("more").hidden = true;
    return;
  }
  const next = mistakes.slice(shownMistakes, shownMistakes + 6);
  shownMistakes += next.length;
  container.append(...next.map((m) => renderMistake(m, strict)));
  const more = $<HTMLButtonElement>("more");
  more.hidden = shownMistakes >= mistakes.length;
  more.textContent = `Show more mistakes (${mistakes.length - shownMistakes} left)`;
}

function renderMistake(m: Scored, strict: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = "mistake";
  const typed = document.createElement("p");
  typed.className = "mistake-typed";
  typed.textContent = m.row.input;

  const split = strict ? splitWords : lenientSplitWords;
  const expected = normalize(m.row.expected!);
  const reference = new Map<string, number>();
  for (const w of split(expected)) reference.set(w, (reference.get(w) ?? 0) + 1);

  const line = (label: string, text: string, highlight: boolean) => {
    const row = document.createElement("div");
    row.className = "mistake-line";
    const tag = document.createElement("span");
    tag.className = "mistake-label";
    tag.textContent = label;
    const body = document.createElement("span");
    body.className = "mistake-text";
    body.dir = "rtl";
    body.lang = "fa";
    if (highlight) {
      // Mark words the person did not write. A readable approximation of the
      // alignment the score uses, not the score itself.
      const left = new Map(reference);
      const words = text.split(/(\s+)/);
      for (const piece of words) {
        const folded = split(piece)[0];
        if (!piece.trim() || folded === undefined) {
          body.append(piece);
          continue;
        }
        const count = left.get(folded) ?? 0;
        if (count > 0) {
          left.set(folded, count - 1);
          body.append(piece);
        } else {
          const wrong = document.createElement("mark");
          wrong.textContent = piece;
          body.append(wrong);
        }
      }
    } else {
      body.textContent = text;
    }
    row.append(tag, body);
    return row;
  };
  box.append(typed, line("Person wrote", expected, false), line("Engine wrote", m.got, true));
  return box;
}

// ---------------------------------------------------------------- tabs

function selectTab(tab: HTMLButtonElement): void {
  for (const other of document.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
    const active = other === tab;
    other.setAttribute("aria-selected", String(active));
    other.tabIndex = active ? 0 : -1;
    $(other.getAttribute("aria-controls")!).hidden = !active;
  }
  closePopover();
  if (tab.id === "tab-accuracy") void runAccuracy();
}

const tabs = [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")];
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
    next.focus();
    selectTab(next);
  });
}

// ---------------------------------------------------------------- util

function placeholder(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "placeholder";
  p.textContent = text;
  return p;
}

function fact(text: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

// ---------------------------------------------------------------- wire

$("input").addEventListener("input", convert);
for (const input of document.querySelectorAll<HTMLInputElement>("input[name=setup]")) {
  input.addEventListener("change", convert);
}
$("context").addEventListener("change", convert);
$("copy").addEventListener("click", () => void copyOutput());
$("set").addEventListener("change", () => void runAccuracy());
$("strict").addEventListener("change", () => void runAccuracy());
// Converting is the slow part and both tiers are scored in the same pass, so
// the strict toggle only re-renders.
$("mistakes-of").addEventListener("change", () => {
  shownMistakes = 0;
  $("mistakes").replaceChildren();
  showMistakes();
});
$("more").addEventListener("click", showMistakes);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopover(true);
});
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest("#popover") && !target.closest(".word")) closePopover();
});

void loadAssets().then(() => {
  renderExamples();
  convert();
});

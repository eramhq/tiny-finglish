/**
 * The playground. Its job is not to look impressive but to make every decision
 * the pipeline makes inspectable — `PLAN.md`'s M1 exit condition is that a
 * human can see every candidate and its reason.
 */
import { Transliterator, decodeFrontCoded, type TransliterationResult } from "../../src/index.ts";
import type { WeightArtifact } from "../../src/quant.ts";

/** Served front-coded but uncompressed — see the plugin in vite.config.ts. */
const LEXICON_URL = "/lexicon.bin";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const output = $<HTMLElement>("output");
const confidenceEl = $<HTMLElement>("confidence");
const timingEl = $<HTMLElement>("timing");
const engineEl = $<HTMLElement>("engine");
const alternativesEl = $<HTMLOListElement>("alternatives");
const spansEl = $<HTMLElement>("spans");
const useModel = $<HTMLInputElement>("use-model");
const useLexicon = $<HTMLInputElement>("use-lexicon");
const useSnap = $<HTMLInputElement>("use-snap");
const beam = $<HTMLInputElement>("beam");

let weights: WeightArtifact | undefined;
let lexicon: Set<string> | undefined;
let engine: Transliterator;

async function loadAssets(): Promise<void> {
  // Weights are optional: without them the rule baseline runs, which is the
  // point of having a deterministic floor.
  try {
    const module = await import("../../data/fixtures/weights.json");
    weights = (module.default ?? module) as unknown as WeightArtifact;
  } catch {
    weights = undefined;
    useModel.checked = false;
    useModel.disabled = true;
  }

  try {
    const response = await fetch(LEXICON_URL);
    if (!response.ok) throw new Error(`lexicon ${response.status}`);
    lexicon = new Set(decodeFrontCoded(new Uint8Array(await response.arrayBuffer())));
  } catch {
    lexicon = undefined;
    useLexicon.checked = false;
    useLexicon.disabled = true;
  }
}

function rebuild(): void {
  engine = new Transliterator({
    ...(useModel.checked && weights ? { model: weights } : {}),
    ...(useLexicon.checked && lexicon ? { lexicon } : {}),
    useLexiconSnap: useSnap.checked,
  });
  render();
}

function render(): void {
  const started = performance.now();
  const result = engine.transliterate(input.value, { beamWidth: Number(beam.value) || 8 });
  const elapsed = performance.now() - started;

  output.textContent = result.text;
  confidenceEl.textContent = `confidence ${(result.confidence * 100).toFixed(1)}%`;
  timingEl.textContent = `${elapsed.toFixed(2)} ms`;
  engineEl.textContent = engine.hasModel ? "engine: model" : "engine: rules";

  alternativesEl.replaceChildren(
    ...(result.alternatives.length
      ? result.alternatives.map((text) => {
          const li = document.createElement("li");
          li.textContent = text;
          return li;
        })
      : [emptyNote("no alternatives — every span had a single candidate")]),
  );

  spansEl.replaceChildren(...result.spans.filter((s) => s.action !== "space").map(renderSpan));
}

function emptyNote(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
}

function renderSpan(span: TransliterationResult["spans"][number]): HTMLElement {
  const box = document.createElement("div");
  box.className = "span";

  const head = document.createElement("div");
  head.className = "span-head";

  const tag = document.createElement("span");
  tag.className = `tag ${span.action}`;
  tag.textContent = span.copyReason ? `${span.action}:${span.copyReason}` : span.action;

  const src = document.createElement("span");
  src.className = "src";
  src.textContent = JSON.stringify(span.input);

  const arrow = document.createElement("span");
  arrow.className = "reason";
  arrow.textContent = "→";

  const dst = document.createElement("span");
  dst.className = "dst";
  dst.dir = "rtl";
  dst.textContent = span.output;

  head.append(tag, src, arrow, dst);
  box.append(head);

  if (span.candidates && span.candidates.length > 0) {
    const list = document.createElement("ul");
    list.className = "cands";
    for (const candidate of span.candidates) {
      const row = document.createElement("li");
      row.className = "cand";

      const out = document.createElement("span");
      out.className = "out";
      out.dir = "rtl";
      out.textContent = candidate.output;

      const bar = document.createElement("span");
      bar.className = "bar";
      bar.style.width = `${Math.max(candidate.probability * 100, 1)}%`;

      const reason = document.createElement("span");
      reason.className = "reason";
      reason.textContent = `${(candidate.probability * 100).toFixed(1)}% · ${candidate.reason}`;

      row.append(out, bar, reason);
      list.append(row);
    }
    box.append(list);
  }
  return box;
}

input.addEventListener("input", render);
for (const control of [useModel, useLexicon, useSnap]) control.addEventListener("change", rebuild);
beam.addEventListener("change", render);

void loadAssets().then(rebuild);

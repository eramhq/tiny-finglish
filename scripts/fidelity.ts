/**
 * Does LLM-typed Finglish look like human-typed Finglish? Plan step 3.2, run
 * before any LLM-generated data is used for anything.
 *
 *   node scripts/fidelity.ts [DIR]     # default training/runs/llm/fidelity
 *
 * LLM "typists" (`data/provenance/prompts/distill-generate.md`) romanized the
 * dev set's own Persian — the `faithful` side, which is what the human typed —
 * so every LLM sentence has a human sentence for the same words. Three views:
 *
 *   1. **Converter accuracy.** The shipped rule engine on the LLM typing and on
 *      the human typing, both scored against `faithful`. If LLM typing is much
 *      easier to convert, it is too clean to teach robustness.
 *   2. **Distance to the human.** Character error rate between the LLM sentence
 *      and the human sentence, letters and spaces only.
 *   3. **Habits.** Rates of the spelling choices `src/rules.ts` measured on real
 *      typing — `aa`, `oo`/`ou`/`u`, `q`, `x`, `w`, `c`, apostrophes, word-final
 *      `eh`, vowel density, detached affix tokens — and an L1 distance between
 *      each typist's habit vector and the human's.
 */
import { readdirSync, readFileSync } from "node:fs";
import { characterErrorRate, wordAccuracy } from "../src/metrics.ts";
import { normalize } from "../src/normalize.ts";
import { buildTransliterator, loadFixtures } from "./_load.ts";

const dir = process.argv[2] ?? "training/runs/llm/fidelity";
const dev = new Map(loadFixtures("data/dev/dev.jsonl").map((row) => [row.id, row]));
const engine = buildTransliterator({ model: false });

interface Typed { id: string; text: string }
const typists = new Map<string, Typed[]>();
for (const name of readdirSync(dir)) {
  const match = /^(\w+)-gen-\d+\.jsonl$/.exec(name);
  if (!match) continue;
  for (const line of readFileSync(`${dir}/${name}`, "utf8").split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line) as { id: string; persona: string; finglish: string[] };
    const key = `${match[1]}/${row.persona}`;
    const list = typists.get(key) ?? [];
    list.push({ id: row.id, text: row.finglish.join(" ") });
    typists.set(key, list);
  }
}

const letters = (text: string) => text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();

function habits(texts: readonly string[]): Record<string, number> {
  let chars = 0, vowels = 0, words = 0;
  const count: Record<string, number> = {};
  const add = (key: string, n: number) => (count[key] = (count[key] ?? 0) + n);
  for (const raw of texts) {
    const text = letters(raw);
    for (const word of text.split(" ").filter(Boolean)) {
      words++;
      chars += word.replace(/'/g, "").length;
      vowels += (word.match(/[aeiou]/g) ?? []).length;
      add("aa", (word.match(/aa/g) ?? []).length);
      add("oo", (word.match(/oo/g) ?? []).length);
      add("ou", (word.match(/ou/g) ?? []).length);
      add("u (not ou)", (word.match(/(?<!o)u/g) ?? []).length);
      add("ee", (word.match(/ee/g) ?? []).length);
      add("q", (word.match(/q/g) ?? []).length);
      add("x", (word.match(/x/g) ?? []).length);
      add("w", (word.match(/w/g) ?? []).length);
      add("c (not ch)", (word.match(/c(?!h)/g) ?? []).length);
      add("apostrophe", (word.match(/'/g) ?? []).length);
      add("final eh", /eh$/.test(word) ? 1 : 0);
      add("final e", /[^e]e$/.test(word) ? 1 : 0);
      add("detached affix", /^(mi|nemi|ha|haa|haye|haaye|e|ye|ro|ra|raa|am|ast)$/.test(word) ? 1 : 0);
    }
  }
  const out: Record<string, number> = { "vowel share": vowels / chars, "letters/word": chars / words };
  for (const [key, n] of Object.entries(count)) out[`${key} /100w`] = (100 * n) / words;
  return out;
}

const human = [...new Set([...typists.values()].flat().map((t) => t.id))].map((id) => dev.get(id)!).filter(Boolean);
const humanHabits = habits(human.map((row) => row.input));
const keys = Object.keys(humanHabits);

function scoreConversion(rows: ReadonlyArray<{ id: string; text: string }>): number {
  let correct = 0, total = 0;
  for (const { id, text } of rows) {
    const w = wordAccuracy(normalize(dev.get(id)!.faithful!), normalize(engine.transliterate(text).text));
    correct += w.correct;
    total += w.total;
  }
  return (100 * correct) / total;
}

const humanRows = human.map((row) => ({ id: row.id, text: row.input }));
console.log(`rows ${human.length}; rule engine on the human typing, against faithful: ${scoreConversion(humanRows).toFixed(1)}%\n`);
console.log(`| typist | sentences | engine on its typing | engine on human, same rows | CER to human | habit L1 to human |`);
console.log(`|---|---:|---:|---:|---:|---:|`);
const habitRows: Array<[string, Record<string, number>]> = [["human", humanHabits]];
for (const [key, rows] of [...typists].sort()) {
  const same = rows.map((r) => ({ id: r.id, text: dev.get(r.id)!.input }));
  let cer = 0;
  for (const r of rows) cer += characterErrorRate(letters(dev.get(r.id)!.input), letters(r.text));
  const h = habits(rows.map((r) => r.text));
  habitRows.push([key, h]);
  // Each habit scaled by the human's own value, so `q` and `vowel share` weigh alike.
  const l1 = keys.reduce((sum, k) => sum + Math.abs(h[k]! - humanHabits[k]!) / Math.max(humanHabits[k]!, 0.5), 0) / keys.length;
  console.log(`| ${key} | ${rows.length} | ${scoreConversion(rows).toFixed(1)}% | ${scoreConversion(same).toFixed(1)}% | ${(cer / rows.length).toFixed(3)} | ${l1.toFixed(2)} |`);
}
console.log(`\n| habit | ${habitRows.map(([k]) => k).join(" | ")} |`);
console.log(`|---|${habitRows.map(() => "---:|").join("")}`);
for (const k of keys) console.log(`| ${k} | ${habitRows.map(([, h]) => h[k]!.toFixed(2)).join(" | ")} |`);

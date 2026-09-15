/**
 * Build the committed lexicon artifact from the upstream Hunspell dictionary.
 *
 *     node scripts/build-lexicon.ts            # stems only — what is committed
 *     node scripts/build-lexicon.ts --affixes  # + the fa-IR.aff expansion
 *
 * Upstream is Lilak fa-IR (Apache-2.0), fetched by `scripts/fetch-lexicon.sh`
 * into `data/lexicon/upstream/`, which is gitignored. What gets committed is
 * the small derived artifact plus a provenance record carrying the upstream
 * SHA-256, so the chain from source to shipped bytes is auditable.
 *
 * **The affix rules are implemented and NOT applied**, which is a measurement
 * and not an oversight. `fa-IR.aff` sits beside the stem list unused, and
 * `data/provenance/lexicon.json` carried a note predicting it would yield
 * "~1.29M surface forms for ~1.2 KiB more Brotli". Running it (`--affixes`)
 * says otherwise, on every axis it was meant to win:
 *
 *   | | stems only | + affixes |
 *   |---|---:|---:|
 *   | entries | 100,761 | 1,512,557 |
 *   | Brotli | 100.7 KiB | **233.0 KiB** |
 *   | gold word acc, rules + freq | 62.0% | 62.1% |
 *   | fixtures word acc, rules + freq | 71.1% | **69.8%** |
 *   | `bench.ts` sentence, cold | 19.6 ms | **297.9 ms** (gate: 100) |
 *
 * The size prediction was wrong by two orders of magnitude. The accuracy is
 * flat because of *where* the lexicon is consulted: `RuleBaseline` scores
 * membership in the candidate pool, after the beam has generated it, so the
 * lexicon is a reranker and cannot propose a form the walk never reached. The
 * fixture regression is the same mechanism running backwards — with 1.5M forms
 * attested, a flat `LEXICON_BONUS` stops discriminating and promotes junk. And
 * building a 1.5M-entry `Set` at load blows the cold-start gate threefold.
 *
 * The expansion is kept behind the flag because the finding is worth being able
 * to reproduce, and because a future ranking that weights membership by
 * *specificity* rather than flatly might change the verdict.
 */
import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { encodeFrontCoded, decodeFrontCoded } from "../src/frontcode.ts";
import { normalize } from "../src/normalize.ts";

const root = new URL("..", import.meta.url);
const APPLY_AFFIXES = process.argv.includes("--affixes");

const dicPath = new URL("data/lexicon/upstream/fa-IR.dic", root);
const affPath = new URL("data/lexicon/upstream/fa-IR.aff", root);
const raw = readFileSync(dicPath);
const text = raw.toString("utf8");
const affRaw = readFileSync(affPath);

// ------------------------------------------------------------------ affixes

interface Affix {
  kind: "PFX" | "SFX";
  /** Characters removed from the stem before adding. Always "0" upstream. */
  strip: string;
  add: string;
  /** Further classes that may apply to the form this produces. */
  continuations: string[];
  /** Hunspell condition; upstream uses "." throughout, meaning "always". */
  condition: string;
}

/**
 * Parse the affix table.
 *
 * `FLAG long` is declared in the header, so flags are fixed two-character
 * pairs and `/pascspsgshsismsjsdsesf` is thirteen of them, not one name. Rules
 * carry their own flags too — `SFX sj 0 ان/sa .` means "after adding ان, the
 * `sa` class may apply again", which is how Lilak spells the possessive on a
 * plural. Those continuations are followed; the rest of the flag alphabet is
 * compound bookkeeping (`FF`, `WW`, `UU`, `CC`, `OO`, `PP`, `AA`) that names
 * no class and is ignored by lookup.
 */
function parseAffixes(source: string): Map<string, Affix[]> {
  const byFlag = new Map<string, Affix[]>();
  for (const line of source.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] !== "PFX" && parts[0] !== "SFX") continue;
    // The class header line is `SFX <flag> <cross-product> <count>`; only the
    // rule lines that follow it carry a strip/add/condition triple.
    if (parts.length < 5) continue;
    const [kind, flag, strip, addField, condition] = parts as [
      "PFX" | "SFX", string, string, string, string,
    ];
    const [add, flagField] = addField.split("/");
    const list = byFlag.get(flag) ?? [];
    list.push({
      kind,
      strip,
      add: add ?? "",
      continuations: splitFlags(flagField ?? ""),
      condition: condition ?? ".",
    });
    byFlag.set(flag, list);
  }
  return byFlag;
}

/** `FLAG long`: two ASCII characters per flag, concatenated without separators. */
function splitFlags(field: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < field.length; i += 2) out.push(field.slice(i, i + 2));
  return out;
}

const AFFIXES = parseAffixes(affRaw.toString("utf8"));

/**
 * Every surface form `stem` can take under `flags`.
 *
 * Depth-limited rather than exhaustive. Every continuation chain upstream is
 * at most two deep (`st` -> `so`, `sj` -> `sa`), so a limit of 3 covers the
 * table with room to spare and makes a cycle in a future revision a bounded
 * mistake instead of a hang.
 */
function expand(stem: string, flags: readonly string[], into: Set<string>, depth = 0): void {
  if (depth >= 3) return;
  for (const flag of flags) {
    for (const affix of AFFIXES.get(flag) ?? []) {
      const base = affix.strip === "0" ? stem : stripSuffix(stem, affix);
      if (base === null) continue;
      const surface = affix.kind === "SFX" ? base + affix.add : affix.add + base;
      into.add(surface);
      if (affix.continuations.length) expand(surface, affix.continuations, into, depth + 1);
    }
  }
}

function stripSuffix(stem: string, affix: Affix): string | null {
  if (affix.kind === "SFX") {
    return stem.endsWith(affix.strip) ? stem.slice(0, -affix.strip.length) : null;
  }
  return stem.startsWith(affix.strip) ? stem.slice(affix.strip.length) : null;
}

// -------------------------------------------------------------------- build

// Hunspell .dic: a count line, then `stem/FLAGS` per line.
const words = new Set<string>();
let stemCount = 0;
const surfaces = new Set<string>();

for (const line of text.split("\n").slice(1)) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  const [stemField, flagField] = trimmed.split("/");
  const stem = stemField!.trim();
  if (!stem) continue;

  const forms = [stem];
  if (APPLY_AFFIXES && flagField) {
    surfaces.clear();
    expand(stem, splitFlags(flagField.trim()), surfaces);
    forms.push(...surfaces);
  }

  let added = false;
  for (const form of forms) {
    const normalized = normalize(form);
    // Keep single-token Persian entries only; the runtime snap tier looks words
    // up, and multi-word entries would never match a single span.
    if (!normalized || /\s/.test(normalized)) continue;
    words.add(normalized);
    added ||= form === stem;
  }
  if (added) stemCount++;
}

const sorted = [...words].sort();
const encoded = encodeFrontCoded(sorted);
const compressed = brotliCompressSync(encoded, {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: encoded.length,
  },
});

// Round-trip before committing. A corrupted lexicon would fail silently as a
// slow accuracy regression rather than a crash.
const decoded = decodeFrontCoded(encoded);
if (decoded.length !== sorted.length || decoded.some((w, i) => w !== sorted[i])) {
  throw new Error("front-coding round-trip failed");
}

mkdirSync(new URL("data/lexicon", root), { recursive: true });
writeFileSync(new URL("data/lexicon/fa-stems.bin", root), compressed);

const ruleCount = [...AFFIXES.values()].reduce((sum, list) => sum + list.length, 0);

const provenance = {
  $comment: "GENERATED by scripts/build-lexicon.ts. Records the chain from upstream source to committed artifact.",
  name: "Lilak, Persian Spell Checking Dictionary",
  version: "fa-IR, via npm dictionary-fa@2.0.0",
  license: "Apache-2.0",
  licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  homepage: "https://github.com/b00f/lilak",
  retrieved: new Date().toISOString().slice(0, 10),
  upstream: {
    file: "data/lexicon/upstream/fa-IR.dic",
    bytes: raw.length,
    sha256: createHash("sha256").update(raw).digest("hex"),
    entries: text.split("\n").length - 1,
    affixFile: "data/lexicon/upstream/fa-IR.aff",
    affixBytes: affRaw.length,
    affixSha256: createHash("sha256").update(affRaw).digest("hex"),
    affixClasses: AFFIXES.size,
    affixRules: ruleCount,
  },
  derived: {
    file: "data/lexicon/fa-stems.bin",
    affixesApplied: APPLY_AFFIXES,
    uniqueStems: stemCount,
    uniqueForms: sorted.length,
    frontCodedBytes: encoded.length,
    brotliBytes: compressed.length,
    bytesPerWord: +(compressed.length / sorted.length).toFixed(4),
    sha256: createHash("sha256").update(compressed).digest("hex"),
  },
  notes: [
    "Stems are normalized with src/normalize.ts before deduplication, so the artifact is in the same canonical form as every model output.",
    "Multi-token entries are dropped: the runtime snap tier matches single spans.",
    APPLY_AFFIXES
      ? "Affix rules (fa-IR.aff) applied, per stem and per flag, including the two-deep continuation classes (st -> so, sj -> sa). FLAG long, so flags are two characters each. Cross-product is N throughout upstream, so prefixes and suffixes are not combined."
      : "Affix rules (fa-IR.aff) are implemented but NOT applied; run with --affixes to reproduce. Measured: 1,512,557 forms at 233.0 KiB Brotli — not the ~1.2 KiB the earlier note predicted — for +0.1 points on gold, -1.3 on the fixtures, and a cold-sentence time of 297.9 ms against the 100 ms gate. The lexicon is consulted as a reranker over candidates the beam already produced, so more surface forms cannot reach the words it never proposes.",
    "No frequency ranking is included. That lives in data/lexicon/fa-frequency.bin, built from HomoRich; membership says a word exists, frequency says which of two real words was meant.",
  ],
};
writeFileSync(
  new URL("data/provenance/lexicon.json", root),
  `${JSON.stringify(provenance, null, 2)}\n`,
);

const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`affix classes   ${AFFIXES.size} (${ruleCount} rules)  applied=${APPLY_AFFIXES}`);
console.log(`stems           ${stemCount.toLocaleString()}`);
console.log(`surface forms   ${sorted.length.toLocaleString()}`);
console.log(`front-coded     ${kib(encoded.length)}`);
console.log(`+ brotli        ${kib(compressed.length)}  (${provenance.derived.bytesPerWord} bytes/word)`);
console.log(`round-trip      ok`);

/**
 * Dictionary-driven candidates and a noisy-channel score — the recall and the
 * ranking the letter-by-letter beam in `baseline.ts` cannot reach.
 *
 * **Why this exists, measured.** On the rules + frequency engine, 87% of the
 * reference words it gets wrong on real Finglish are *already in the shipped
 * 25k frequency table*. The data was never the bottleneck; generating and
 * ranking candidates from it was. Two separate failures:
 *
 *   * **Recall.** The beam builds spellings left to right from per-letter
 *     choices and keeps 48. A word whose letters are each individually
 *     unlikely — عذر from `ozr`, ظ, ع, ذ all rare — falls off the beam before
 *     frequency can see it.
 *   * **Ranking.** The beam's score is P(fa | latin): every ambiguous unit asks
 *     "which Persian letter is this?", which charges ظ for being rare. The
 *     frequency bonus *also* charges it for being rare. نزار beats نظر.
 *
 * This module fixes both from the same grapheme table, adding no data:
 *
 *   * `SkeletonIndex` buckets every table word by its **consonant skeleton** —
 *     vowels and vowel letters dropped, homophone classes folded (س/ص/ث,
 *     ز/ذ/ض/ظ, ت/ط, ق/غ, ه/ح, ج/ژ), doubles collapsed. `ozr` and عذر both key to
 *     `زر`. A lookup is one `Map.get`.
 *   * `Channel` scores a (Latin, Persian) pair by forced alignment:
 *     max over alignments of Σ log P(latin unit | Persian grapheme). That is the
 *     other side of Bayes' rule from the beam — `s` is equally likely from س
 *     and ص — so rarity is charged exactly once, by the frequency term the
 *     caller adds.
 *
 * Everything is built at construction from `src/rules.ts` and the frequency
 * table the caller already fetched; there is no artifact and no byte on the
 * wire.
 */

import {
  GRAPHEMES,
  type Grapheme,
  type Position,
} from "./rules.ts";

const ZWNJ = "‌";

// -- skeleton keys -----------------------------------------------------------

/** Persian letters with no consonant identity in Finglish typing. */
const PERSIAN_DROP = new Set([..."اآأإوؤیئءع", ZWNJ, "ٔ"]);
/** Homophone classes, each folded to the member typing cannot distinguish from. */
const PERSIAN_FOLD: Readonly<Record<string, string>> = {
  "ص": "س", "ث": "س", "ذ": "ز", "ض": "ز", "ظ": "ز", "ط": "ت", "غ": "ق", "ح": "ه", "ژ": "ج",
};
const PERSIAN_KEYED = new Set([..."بپتثجچحخدذرزژسشصضطظغفقکگلمنه"]);

const LATIN_DIGRAPHS: Readonly<Record<string, string>> = {
  kh: "خ", gh: "ق", sh: "ش", ch: "چ", zh: "ج",
};
const LATIN_SINGLE: Readonly<Record<string, string>> = {
  b: "ب", p: "پ", t: "ت", s: "س", j: "ج", h: "ه", d: "د", r: "ر", z: "ز", f: "ف",
  k: "ک", c: "ک", g: "گ", l: "ل", m: "م", n: "ن", q: "ق", x: "خ",
};

function finishKey(letters: string[]): string {
  const out: string[] = [];
  for (const letter of letters) if (out[out.length - 1] !== letter) out.push(letter);
  // A final ه is the silent he of خانه as often as a real /h/, and a final h
  // in Latin is as often `eh` as a consonant. Dropping it on both sides costs
  // nothing: the channel score still sees every letter.
  if (out[out.length - 1] === "ه") out.pop();
  return out.join("");
}

/** Consonant skeleton of a Persian word. `null` if it holds anything but Persian letters. */
export function persianSkeleton(word: string): string | null {
  let key = "";
  for (const ch of word) {
    if (PERSIAN_DROP.has(ch)) continue;
    if (!PERSIAN_KEYED.has(ch)) return null;
    const folded = PERSIAN_FOLD[ch] ?? ch;
    if (key[key.length - 1] !== folded) key += folded;
  }
  return key.endsWith("ه") ? key.slice(0, -1) : key;
}

/** Consonant skeleton of a lowercase Finglish word, in the same alphabet. */
export function latinSkeleton(word: string): string {
  const letters: string[] = [];
  for (let i = 0; i < word.length; i++) {
    const digraph = LATIN_DIGRAPHS[word.slice(i, i + 2)];
    if (digraph) {
      letters.push(digraph);
      i++;
      continue;
    }
    const single = LATIN_SINGLE[word[i]!];
    if (single) letters.push(single);
  }
  return finishKey(letters);
}

/**
 * Frequency-table words bucketed by skeleton, each bucket most frequent first.
 *
 * Words carrying a ZWNJ are indexed in their solid form, which is the rule
 * engine's own output convention (it cannot emit ZWNJ) and the one both real
 * evaluation sets use. When the solid and ZWNJ forms are both in the table the
 * higher frequency is kept. ZWNJ placement is the learned model's job.
 */
export class SkeletonIndex {
  private readonly buckets = new Map<string, string[]>();
  /** Word -> frequency score, over the solid forms the index returns. */
  readonly frequency: ReadonlyMap<string, number>;

  constructor(frequency: ReadonlyMap<string, number>) {
    // Part of cold start, so it is built in one pass and each bucket sorted on
    // its own: sorting 25k entries up front cost more than everything else here.
    const solid = new Map<string, number>();
    for (const [word, score] of frequency) {
      const form = word.includes(ZWNJ) ? word.replaceAll(ZWNJ, "") : word;
      const existing = solid.get(form);
      if (existing === undefined || existing < score) solid.set(form, score);
    }
    this.frequency = solid;
    for (const word of solid.keys()) {
      const key = persianSkeleton(word);
      if (key === null) continue;
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(word);
      else this.buckets.set(key, [word]);
    }
    for (const bucket of this.buckets.values()) {
      if (bucket.length > 1) bucket.sort((a, b) => solid.get(b)! - solid.get(a)! || (a < b ? -1 : 1));
    }
  }

  /** Up to `limit` table words sharing the skeleton of `latin`, most frequent first. */
  lookup(latin: string, limit: number): readonly string[] {
    return (this.buckets.get(latinSkeleton(latin)) ?? []).slice(0, limit);
  }
}

// -- channel -----------------------------------------------------------------

interface Emission {
  latin: string;
  logProb: number;
}

/** One step of a forced alignment. */
export interface AlignmentStep {
  kind: "emit" | "insert" | "geminate";
  /** Persian grapheme consumed; empty for an insertion or gemination. */
  fa: string;
  /** Latin unit consumed; empty when a Persian letter is silent (ع typed as nothing). */
  latin: string;
  pos: Position;
}

/** A channel re-estimated from word pairs: probabilities, not logs. */
export interface FittedChannel {
  /** `"fa|position"` -> Latin spelling -> P(spelling | fa, position). */
  emissions: Record<string, Record<string, number>>;
  /** Position -> short vowel letter -> P(letter | unwritten vowel). */
  insertions: Record<string, Record<string, number>>;
}

/**
 * log P(latin | Persian), by forced alignment against the grapheme table.
 *
 * For a Persian grapheme at a position, the distribution over Latin spellings
 * mixes every table entry with that output there, weighted by the entry's
 * prior `w`, each entry's spellings weighted by the measured `latinWeights`
 * where they exist and by `1/(k+1)` where they do not — the same discount
 * `buildReverseTable` applies. So `s` is log 1 from both س and ص, `a` is
 * log 0.69 from medial ا, and خو costs its silent و's small share of `kh`.
 *
 * Two Latin events have no Persian letter and are charged explicitly:
 *
 *   * an **unwritten short vowel** — the carrier entry's `a`/`e`/`o` with an
 *     empty output — costs `log(1/3) + log(insertion)`;
 *   * a **doubled consonant** — `ammaa` for اما, where Persian does not write
 *     gemination — costs `gemination`.
 *
 * Both are tuned on the dev set (see `baseline.ts`), not on gold.
 */
export class Channel {
  private readonly emissions = new Map<string, Map<Position, Emission[]>>();
  private readonly insertions = new Map<Position, Emission[]>();
  private outputs: readonly string[];
  private readonly gemination: number;

  constructor(
    params: { insertion: number; gemination: number },
    graphemes: readonly Grapheme[] = GRAPHEMES,
  ) {
    this.gemination = params.gemination;
    const positions: readonly Position[] = ["initial", "medial", "final"];
    const byOutput = new Map<string, Map<Position, Map<string, number>>>();
    const mass = new Map<string, number>();

    for (const g of graphemes) {
      if (g.role === "zwnj") continue;
      const weights = g.latin.map((_, k) => g.latinWeights?.[k] ?? 1 / (k + 1));
      const total = weights.reduce((a, b) => a + b, 0);
      for (const pos of g.pos ?? positions) {
        const massKey = `${g.fa} ${pos}`;
        mass.set(massKey, (mass.get(massKey) ?? 0) + g.w);
        const perPos = byOutput.get(g.fa) ?? new Map<Position, Map<string, number>>();
        byOutput.set(g.fa, perPos);
        const spellings = perPos.get(pos) ?? new Map<string, number>();
        perPos.set(pos, spellings);
        g.latin.forEach((latin, k) => {
          spellings.set(latin, (spellings.get(latin) ?? 0) + g.w * (weights[k]! / total));
        });
      }
    }

    for (const [fa, perPos] of byOutput) {
      for (const [pos, spellings] of perPos) {
        const total = mass.get(`${fa} ${pos}`)!;
        const list = [...spellings].map(([latin, m]) => ({ latin, logProb: Math.log(m / total) }));
        if (fa === "") {
          this.insertions.set(pos, list
            .filter((e) => e.latin !== "")
            .map((e) => ({ latin: e.latin, logProb: e.logProb + Math.log(params.insertion) })));
          continue;
        }
        const target = this.emissions.get(fa) ?? new Map<Position, Emission[]>();
        this.emissions.set(fa, target);
        target.set(pos, list);
      }
    }
    // Longest outputs first, so خو and او are tried alongside خ and ا.
    this.outputs = [...this.emissions.keys()].sort((a, b) => b.length - a.length);
  }

  /** Best-alignment log probability, or `-Infinity` when no alignment exists. */
  score(latin: string, fa: string): number {
    return this.run(latin, fa, undefined);
  }

  /**
   * The best alignment itself, one step per Latin unit or Persian grapheme —
   * what `scripts/fit-channel.ts` counts to re-estimate the channel. `null`
   * when no alignment exists.
   */
  align(latin: string, fa: string): AlignmentStep[] | null {
    const steps: Array<AlignmentStep & { from: number } | undefined> = [];
    if (this.run(latin, fa, steps) === -Infinity) return null;
    const width = fa.length + 1;
    const path: AlignmentStep[] = [];
    for (let at = latin.length * width + fa.length; at !== 0;) {
      const step = steps[at]!;
      path.push({ kind: step.kind, fa: step.fa, latin: step.latin, pos: step.pos });
      at = step.from;
    }
    return path.reverse();
  }

  /** Current log probabilities, as `fit-channel.ts` reads them for its prior. */
  distributions(): { emissions: FittedChannel["emissions"]; insertions: FittedChannel["insertions"] } {
    const emissions: FittedChannel["emissions"] = {};
    for (const [fa, perPos] of this.emissions) {
      for (const [pos, list] of perPos) emissions[`${fa}|${pos}`] = Object.fromEntries(list.map((e) => [e.latin, Math.exp(e.logProb)]));
    }
    const insertions: FittedChannel["insertions"] = {};
    for (const [pos, list] of this.insertions) insertions[pos] = Object.fromEntries(list.map((e) => [e.latin, Math.exp(e.logProb)]));
    return { emissions, insertions };
  }

  /** Replace the table-derived distributions with fitted ones (see `fit-channel.ts`). */
  static fromFitted(fitted: FittedChannel, params: { insertion: number; gemination: number }): Channel {
    const channel = new Channel(params);
    channel.emissions.clear();
    for (const [key, spellings] of Object.entries(fitted.emissions)) {
      const [fa, pos] = key.split("|") as [string, Position];
      const perPos = channel.emissions.get(fa) ?? new Map<Position, Emission[]>();
      channel.emissions.set(fa, perPos);
      perPos.set(pos, Object.entries(spellings).map(([latin, p]) => ({ latin, logProb: Math.log(p) })));
    }
    channel.insertions.clear();
    for (const [pos, spellings] of Object.entries(fitted.insertions)) {
      channel.insertions.set(pos as Position, Object.entries(spellings)
        .map(([latin, p]) => ({ latin, logProb: Math.log(p) + Math.log(params.insertion) })));
    }
    channel.outputs = [...channel.emissions.keys()].sort((a, b) => b.length - a.length);
    return channel;
  }

  private run(latin: string, fa: string, trace: Array<AlignmentStep & { from: number } | undefined> | undefined): number {
    const L = latin.length;
    const P = fa.length;
    if (P === 0) return -Infinity;
    const width = P + 1;
    const best = new Float64Array((L + 1) * width).fill(-Infinity);
    best[0] = 0;
    // Relaxation is written out rather than factored into a closure: `score`
    // runs this for every candidate of every word, and a per-transition
    // allocation cost a quarter of the per-word time. `trace` is only for
    // `align`, which is offline.
    for (let i = 0; i <= L; i++) {
      for (let j = 0; j <= P; j++) {
        const from = i * width + j;
        const here = best[from]!;
        if (here === -Infinity) continue;

        if (j < P) {
          for (const output of this.outputs) {
            if (!fa.startsWith(output, j)) continue;
            const end = j + output.length;
            const pos: Position = j === 0 ? "initial" : end === P ? "final" : "medial";
            const list = this.emissions.get(output)!.get(pos);
            if (!list) continue;
            for (const e of list) {
              if (e.latin !== "" && !latin.startsWith(e.latin, i)) continue;
              const at = (i + e.latin.length) * width + end;
              const value = here + e.logProb;
              if (value > best[at]!) {
                best[at] = value;
                if (trace) trace[at] = { kind: "emit", fa: output, latin: e.latin, pos, from };
              }
            }
          }
        }
        if (i < L) {
          if (j > 0) {
            const pos: Position = j === P ? "final" : "medial";
            for (const e of this.insertions.get(pos) ?? []) {
              if (!latin.startsWith(e.latin, i)) continue;
              // A doubled vowel is a long vowel someone took care to type;
              // `baraa` is برا, never بر with two silent vowels.
              if (i > 0 && latin[i - 1] === e.latin) continue;
              const at = (i + e.latin.length) * width + j;
              const value = here + e.logProb;
              if (value > best[at]!) {
                best[at] = value;
                if (trace) trace[at] = { kind: "insert", fa: "", latin: e.latin, pos, from };
              }
            }
          }
          if (i > 0 && latin[i] === latin[i - 1] && !"aeiou".includes(latin[i]!)) {
            const at = (i + 1) * width + j;
            const value = here + this.gemination;
            if (value > best[at]!) {
              best[at] = value;
              if (trace) trace[at] = { kind: "geminate", fa: "", latin: latin[i]!, pos: "medial", from };
            }
          }
        }
      }
    }
    return best[L * width + P]!;
  }
}

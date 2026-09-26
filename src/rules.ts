/**
 * The grapheme correspondence table — the single source of truth for both
 * directions of the pipeline.
 *
 *   Finglish -> Persian  drives the M1 rule baseline and the decoder's prior.
 *   Persian -> Finglish  drives the synthetic corpus generator in `training/`.
 *
 * `scripts/export-rules.ts` writes this table to `data/rules/graphemes.json`
 * so the Python side reads exactly the same data. Never edit that file by hand.
 *
 * For scale: `elektito/finglish`'s entire rule set is 1,348 bytes across three
 * position-conditioned files. The transliteration rules are genuinely small;
 * everything expensive is disambiguation.
 */

/** Where in a word a correspondence may apply. */
export type Position = "initial" | "medial" | "final";
export const ALL_POSITIONS: readonly Position[] = ["initial", "medial", "final"];

/**
 * What job a correspondence does. The generator needs this because و and ی are
 * each both a consonant and a vowel, and picking the wrong table turns امروز
 * into `emrvz` instead of `emrooz`.
 */
export type Role = "consonant" | "vowel" | "carrier" | "diphthong" | "silent" | "zwnj" | "variant";

export interface Grapheme {
  /** Persian output. May be empty (deletion) or multi-character. */
  fa: string;
  /** Finglish spellings. Index 0 is the canonical/most common form. */
  latin: readonly string[];
  /**
   * Relative likelihood of each entry in `latin`, used by the corpus generator.
   *
   * **Measured, not guessed.** Counted over 21,874 word tokens of real
   * human-written Finglish (`data/gold/gold.jsonl`). Before this existed the
   * generator sampled variants uniformly at a 30% rate, which taught the model
   * that `x` for خ and `q` for ق were ordinary — in real typing they are 0.1%
   * and 3.9%. Generating spellings nobody writes is not robustness, it is a
   * corrupted prior.
   *
   * Omitted where the measurement is confounded: a raw count of `j` cannot
   * separate ژ from ج, and a raw count of `a` cannot separate long ɒː from the
   * unwritten short vowels. Those keep hand-set priors and say so.
   */
  latinWeights?: readonly number[];
  /** Positions in which this correspondence is legal. */
  pos?: readonly Position[];
  /** Which table the generator should draw this from. */
  role: Role;
  /**
   * Relative prior, roughly reflecting corpus frequency of the Persian letter.
   * Used to rank rule-baseline candidates and to weight generator sampling.
   * Not a probability; normalized at use.
   */
  w: number;
}

/**
 * Consonants. Weights reflect the measured Persian letter distribution: the
 * Persian-origin member of each homophone class dominates heavily, which is
 * why a most-frequent tie-break resolves the s/z/t/h/gh choice for ~99.7% of
 * tokens. The Arabic-origin letters are a memorization problem, not a
 * disambiguation problem — they are rare, and when they occur the word is
 * usually the only real word with that consonant frame.
 */
export const CONSONANTS: readonly Grapheme[] = [
  { fa: "ب", latin: ["b"], role: "consonant", w: 100 },
  { fa: "پ", latin: ["p"], role: "consonant", w: 60 },
  { fa: "ت", latin: ["t"], role: "consonant", w: 100 },
  { fa: "ط", latin: ["t"], role: "consonant", w: 12 },
  { fa: "ث", latin: ["s"], role: "consonant", w: 3 },
  { fa: "ج", latin: ["j"], role: "consonant", w: 60 },
  { fa: "چ", latin: ["ch"], role: "consonant", w: 35 },
  { fa: "ح", latin: ["h"], role: "consonant", w: 18 },
  { fa: "ه", latin: ["h"], role: "consonant", w: 100 },
  { fa: "خ", latin: ["kh", "x"], latinWeights: [0.999, 0.001], role: "consonant", w: 70 },
  { fa: "د", latin: ["d"], role: "consonant", w: 100 },
  { fa: "ذ", latin: ["z"], role: "consonant", w: 4 },
  { fa: "ر", latin: ["r"], role: "consonant", w: 100 },
  { fa: "ز", latin: ["z"], role: "consonant", w: 70 },
  { fa: "ض", latin: ["z"], role: "consonant", w: 5 },
  { fa: "ظ", latin: ["z"], role: "consonant", w: 3 },
  { fa: "ژ", latin: ["zh", "j"], latinWeights: [0.7, 0.3], role: "consonant", w: 6 },
  { fa: "س", latin: ["s"], role: "consonant", w: 100 },
  { fa: "ص", latin: ["s"], role: "consonant", w: 12 },
  { fa: "ش", latin: ["sh"], role: "consonant", w: 70 },
  { fa: "غ", latin: ["gh", "q"], latinWeights: [0.961, 0.039], role: "consonant", w: 20 },
  { fa: "ق", latin: ["gh", "q"], latinWeights: [0.961, 0.039], role: "consonant", w: 40 },
  { fa: "ف", latin: ["f"], role: "consonant", w: 80 },
  { fa: "ک", latin: ["k", "c"], latinWeights: [0.982, 0.018], role: "consonant", w: 100 },
  { fa: "گ", latin: ["g"], role: "consonant", w: 60 },
  { fa: "ل", latin: ["l"], role: "consonant", w: 90 },
  { fa: "م", latin: ["m"], role: "consonant", w: 100 },
  { fa: "ن", latin: ["n"], role: "consonant", w: 100 },
  { fa: "و", latin: ["v", "w"], latinWeights: [0.984, 0.016], role: "consonant", w: 90 },
  { fa: "ی", latin: ["y"], role: "consonant", w: 100 },
];

/**
 * Vowels — where the real ambiguity lives. Measured on a 406k-type Persian
 * frequency list: with a "loose" convention that writes both /a/ and /ɒː/ as
 * `a`, 9.5% of token mass lands on an ambiguous form; with a "strict"
 * convention that writes /ɒː/ as `aa`, that falls to 0.6%.
 *
 * 100% of that residual ambiguity is vowel- or ayn-related; none of it is
 * consonant-class. Nudging users toward `aa` is the single cheapest accuracy
 * win available to this project, which is why `aa` is canonical for آ.
 */
export const VOWELS: readonly Grapheme[] = [
  // Long ɒː. Word-initial it is آ; medially and finally it is ا.
  { fa: "آ", latin: ["aa", "a", "â"], latinWeights: [0.30, 0.69, 0.01], pos: ["initial"], role: "vowel", w: 60 },
  { fa: "ا", latin: ["aa", "a", "â"], latinWeights: [0.30, 0.69, 0.01], pos: ["medial", "final"], role: "vowel", w: 100 },
  // Short vowels at word start ride on an alef carrier: امروز `emrooz`.
  { fa: "ا", latin: ["a", "e", "o"], pos: ["initial"], role: "carrier", w: 100 },
  // Short vowels elsewhere are simply unwritten in the abjad. This is the
  // empty label, and it is the most frequent label in the whole set.
  { fa: "", latin: ["a", "e", "o"], pos: ["medial", "final"], role: "carrier", w: 150 },
  // Long uː / oː. A Persian word never *starts* with vowel و or ی: word-initial
  // و and ی are consonants, and a word-initial long vowel rides on alef — او,
  // ای. Without the position restriction `ozr` decoded to وزر and `ide` to ید,
  // because the bare vowel letter outweighs the alef-carried form.
  { fa: "و", latin: ["oo", "u", "ou", "o"], latinWeights: [0.55, 0.22, 0.17, 0.06], pos: ["medial", "final"], role: "vowel", w: 80 },
  { fa: "او", latin: ["oo", "u", "ou"], latinWeights: [0.6, 0.23, 0.17], pos: ["initial"], role: "vowel", w: 25 },
  // Long iː.
  { fa: "ی", latin: ["i", "ee", "y"], latinWeights: [0.96, 0.02, 0.02], pos: ["medial", "final"], role: "vowel", w: 90 },
  { fa: "ای", latin: ["i", "ee"], latinWeights: [0.98, 0.02], pos: ["initial"], role: "vowel", w: 25 },
  // Diphthongs, with the same alef carrier word-initially: `eyval` ایول.
  { fa: "ی", latin: ["ey", "ei", "ay", "ai"], pos: ["medial", "final"], role: "diphthong", w: 20 },
  { fa: "ای", latin: ["ey", "ei"], pos: ["initial"], role: "diphthong", w: 10 },
  { fa: "و", latin: ["ow", "au"], pos: ["medial", "final"], role: "diphthong", w: 10 },
  { fa: "او", latin: ["ow"], pos: ["initial"], role: "diphthong", w: 5 },
  // Final silent he: `khune` خونه, `name` نامه. Extremely common, and only
  // silent after a consonant — دانشگاه `daneshgah` keeps a real /h/.
  { fa: "ه", latin: ["e", "eh", "a", "ah"], latinWeights: [0.62, 0.28, 0.06, 0.04], pos: ["final"], role: "silent", w: 90 },
];

/**
 * Letters with no consistent Finglish realization. ع and ء are usually simply
 * dropped, occasionally written as an apostrophe. They are unguessable from
 * the Latin side, which is the clearest case in the table for "the model must
 * memorize this per word".
 */
export const SILENT: readonly Grapheme[] = [
  { fa: "ع", latin: ["", "'", "a", "e", "o"], role: "silent", w: 55 },
  { fa: "ء", latin: ["", "'"], role: "silent", w: 5 },
  { fa: "ئ", latin: ["", "'", "y", "i"], role: "silent", w: 8 },
  { fa: "ؤ", latin: ["", "'", "v"], role: "silent", w: 2 },
  // The silent و of خوا: `khahar` خواهر, `khab` خواب, `khastan` خواستن.
  { fa: "و", latin: [""], role: "silent", w: 6 },
];

/**
 * ZWNJ. 22.8% of Persian word types contain one, and the rule tables of every
 * prior Finglish tool are structurally incapable of emitting it — which makes
 * every one of those word types guaranteed-wrong. Treating it as an ordinary
 * output label is the fix.
 *
 * Calibration: BERT sequence labelling reaches ~92% macro-F1 on ZWNJ
 * placement, against a measured ~83% correctness for naturally occurring ZWNJ
 * in real Persian text. Human writers get this wrong one time in six. Do not
 * over-engineer it.
 */
export const ZWNJ_RULES: readonly Grapheme[] = [
  { fa: "‌", latin: ["", " ", "-"], role: "zwnj", w: 40 },
];

/**
 * Decoder-only correspondences: spellings real typing produces *across* a
 * grapheme boundary, which the rule baseline must be able to read but the
 * corpus generator must never write.
 *
 * The generator draws spellings by `(fa, role)` and never asks for the
 * `variant` role, so nothing here reaches the training corpus. Each one fixes a
 * whole class of word the per-letter table cannot reach:
 *
 *   * `iy` for one ی. Typists write a glide between /i/ and a following vowel —
 *     `biyaam`, `baghiye`, `ziyaad` — and letter-by-letter that is ی + ی: بییام,
 *     بقییه. As one unit it is one ی, and the unit cost makes it the preferred
 *     reading over two, which is right: a genuine ییـ is typed `yi` or `ee`
 *     (`paayiz`, `ta'yin`), not `iy`.
 *   * `kh` for خو. The silent و of خوا and خوی (`khaahar` خواهر, `mikhaham`
 *     میخواهم, `khish` خویش) has no Latin letter, so the empty spelling in
 *     `SILENT` can never be decoded. Attaching it to `kh` makes it reachable at
 *     the silent و's own prior, w=6 against خ's 70 — a candidate that frequency
 *     can promote, not a default.
 *   * `ci` and `cy` for سی. Chat types loanwords in their own spelling —
 *     `merci` for مرسی, `cinema` for سینما — and a soft `c` is س. As a letter
 *     `c` is only ever ک here (`latinWeights` measured it at 1.8% of ک), so the
 *     softening lives in the unit that carries its context: `c` before `i`/`y`.
 *     `ce` is not here: as a unit it would share س's output with `s`, and the
 *     fitted channel would smooth it to nothing (`Channel.fromFitted`).
 *   * `i` and `ei` for a final یی. Persian writes the glide of a hiatus —
 *     کجایی, تنهایی, دانشجویی — as a second ی, and typists mostly do not type
 *     it: `kojai`, `kojaei`. Letter by letter one `i` is one ی, so every such
 *     word was unreachable however common. Word-final only, where the glide
 *     sits; the frequency table decides whether the doubled ی is a word.
 */
export const VARIANTS: readonly Grapheme[] = [
  { fa: "ی", latin: ["iy"], pos: ["medial", "final"], role: "variant", w: 90 },
  { fa: "خو", latin: ["kh"], role: "variant", w: 6 },
  { fa: "سی", latin: ["ci", "cy"], latinWeights: [0.9, 0.1], role: "variant", w: 2 },
  { fa: "یی", latin: ["i", "ei"], latinWeights: [0.6, 0.4], pos: ["final"], role: "variant", w: 5 },
];

export const GRAPHEMES: readonly Grapheme[] = [
  ...CONSONANTS,
  ...VOWELS,
  ...SILENT,
  ...ZWNJ_RULES,
  ...VARIANTS,
];

/**
 * Latin segmentation units, longest first. Segmentation is greedy-with-
 * backtracking in `segment()`, so this only has to list the multi-character
 * units that exist.
 */
export const LATIN_UNITS: readonly string[] = (() => {
  const units = new Set<string>();
  for (const g of GRAPHEMES) for (const l of g.latin) if (l) units.add(l);
  for (const ch of "abcdefghijklmnopqrstuvwxyz'") units.add(ch);
  return [...units].sort((a, b) => b.length - a.length || a.localeCompare(b));
})();

export interface Correspondence {
  fa: string;
  w: number;
  /** True when this is the canonical spelling of `fa`, not a variant. */
  canonical: boolean;
}

/** Finglish unit -> Persian candidates, indexed by position. */
export type ReverseTable = ReadonlyMap<string, ReadonlyMap<Position, readonly Correspondence[]>>;

/** Build the Finglish -> Persian index used by the rule baseline and decoder prior. */
export function buildReverseTable(graphemes: readonly Grapheme[] = GRAPHEMES): ReverseTable {
  const table = new Map<string, Map<Position, Correspondence[]>>();
  for (const g of graphemes) {
    const positions = g.pos ?? ALL_POSITIONS;
    g.latin.forEach((latin, index) => {
      if (latin === "") return;
      let byPosition = table.get(latin);
      if (!byPosition) table.set(latin, (byPosition = new Map()));
      for (const pos of positions) {
        const list = byPosition.get(pos) ?? [];
        // Variant spellings are discounted: `x` for خ is real but rarer than `kh`.
        list.push({ fa: g.fa, w: g.w / (index + 1), canonical: index === 0 });
        byPosition.set(pos, list);
      }
    });
  }
  for (const byPosition of table.values()) {
    for (const [pos, list] of byPosition) {
      byPosition.set(pos, mergeByOutput(list).sort((a, b) => b.w - a.w));
    }
  }
  return table;
}

function mergeByOutput(list: readonly Correspondence[]): Correspondence[] {
  const merged = new Map<string, Correspondence>();
  for (const c of list) {
    const existing = merged.get(c.fa);
    if (existing) {
      existing.w += c.w;
      existing.canonical ||= c.canonical;
    } else {
      merged.set(c.fa, { ...c });
    }
  }
  return [...merged.values()];
}

/**
 * Split a lowercase Finglish word into grapheme units. Returns every valid
 * segmentation, best (fewest units, preferring longer units) first, capped at
 * `limit` because `variations()`-style enumeration is where prior tools blow up.
 */
export function segment(word: string, limit = 24): string[][] {
  const results: string[][] = [];
  const stack: Array<{ index: number; units: string[] }> = [{ index: 0, units: [] }];

  const walk = (index: number, units: string[]): void => {
    if (results.length >= limit) return;
    if (index === word.length) {
      results.push([...units]);
      return;
    }
    for (const unit of LATIN_UNITS) {
      if (unit.length > word.length - index) continue;
      if (word.startsWith(unit, index)) {
        units.push(unit);
        walk(index + unit.length, units);
        units.pop();
        if (results.length >= limit) return;
      }
    }
  };

  walk(0, []);
  void stack;
  return results;
}

/** Position of unit `i` within a segmentation of `n` units. */
export function positionOf(i: number, n: number): Position {
  if (i === 0) return "initial";
  if (i === n - 1) return "final";
  return "medial";
}

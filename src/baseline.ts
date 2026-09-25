/**
 * The M1 rule-only baseline: the floor every later model must beat.
 *
 * Segments a Finglish word into grapheme units, walks them left to right
 * keeping the best partial spellings, and ranks the survivors by a prior over
 * Persian letters plus lexicon membership.
 *
 * **It is a beam, not a Cartesian product.** The obvious implementation —
 * enumerate every combination of per-unit candidates, then score — is what the
 * existing prior-art tool does, and measured on real vocabulary it produces a
 * median of 504 candidates per word, a p99 of ~92,000 and a maximum of
 * ~367,000. That is a browser hazard for no accuracy: a beam reaches the same
 * top-1 at a fixed cost per character.
 *
 * Known ceiling, from the same measurements: this family of design reaches
 * roughly 81-83% top-1 on *machine-generated* Finglish and less on real input,
 * and its rule tables structurally cannot emit ZWNJ — which alone guarantees a
 * wrong answer on the ~23% of Persian word types that contain one. Both limits
 * are why the learned transducer exists.
 */

import { FITTED_CHANNEL } from "./channel-fitted.ts";
import { Channel, SkeletonIndex, type FittedChannel } from "./dictionary.ts";
import { frequencyScore, type FrequencyTable } from "./frequency.ts";
import { compose, decompose } from "./morph.ts";
import { foldForMatch } from "./normalize.ts";
import {
  buildReverseTable,
  positionOf,
  segment,
  type Correspondence,
  type ReverseTable,
} from "./rules.ts";

export interface BaselineCandidate {
  output: string;
  score: number;
  reason: string;
}

export interface BaselineOptions {
  /** Partial spellings kept while walking the units. */
  beamWidth?: number;
  /** Candidates returned. */
  results?: number;
  /** Attested Persian words. */
  lexicon?: ReadonlySet<string> | undefined;
  /** Word frequencies. Membership says a word exists; this says how likely it is. */
  frequency?: FrequencyTable | undefined;
  /** Segmentations of the Latin string to explore. */
  maxSegmentations?: number;
  /**
   * Further outputs to score alongside the rule candidates, channel mode only —
   * how the learned model's hypotheses enter the same ranking (`index.ts`).
   * Compared with ZWNJ removed, since the rule engine never emits one.
   */
  extra?: readonly string[];
}

/**
 * Search width.
 *
 * `beamWidth` was 24 and is 48 on measurement: swept on `data/fixtures/`, word
 * accuracy rises 71.1% -> 71.5% at 32-48 and is flat from there to 192, while
 * the share of reference words the beam never proposes at all falls 6.5% ->
 * 5.3%. One pass of the 1,835-sentence gold set on a cold cache costs 0.193 ms
 * per sentence at 24 and 0.241 ms at 48 — 1.5% of the 16 ms frame either way,
 * so the knee is where accuracy stops moving, not where time does.
 *
 * `maxSegmentations` is unchanged at 8 because raising it does nothing:
 * `segment()` returns segmentations best-first, and 16, 24 and 32 give
 * byte-identical output on every fixture.
 */
const DEFAULTS = {
  beamWidth: 48,
  results: 3,
  maxSegmentations: 8,
};

/** Log-odds bonus for an output that is an attested Persian word. */
const LEXICON_BONUS = 2.5;

/**
 * Weight on log-quantized corpus frequency.
 *
 * Membership alone cannot separate two real words: سلام and سلم are both
 * Persian, and with only the attested bonus the baseline ranked سلم first
 * because the grapheme prior preferred the shorter spelling. Frequency is what
 * breaks that tie, so it carries more weight than membership does.
 */
const FREQUENCY_BONUS = 5.0;

/**
 * Cost charged per grapheme unit, to make segmentations of different lengths
 * comparable.
 *
 * Without it the score is a sum of per-unit conditionals with no term for
 * *how many* units were used, so a segmentation is free to use more of them —
 * and a unit with exactly one Persian realization costs `log(1) = 0` while an
 * ambiguous one is charged. `gh` is the only ambiguous digraph in the table
 * (`gh` -> ق w=40 and غ w=20, from `src/rules.ts`), so it pays log(40/60) =
 * -0.406 while `g` -> گ pays log(1) = 0 and `h` -> ه pays log(100/118) =
 * -0.166. The split wins by 0.24 nats on every word, and frequency rescues it
 * only when the word is common enough to be in the table: `ghad` -> قد works,
 * `vaaghean` comes out واگهن, `ghazaayiye` گهزایییه, `ghadeshaan` گهدشان.
 *
 * A flat per-unit charge is the smallest fix that is not about `gh`
 * specifically, and it is what a `log P(segmentation)` term looks like if the
 * number of units is modelled as geometric. It must exceed 0.24 nats to
 * reverse that margin. Swept on `data/fixtures/` — never on the gold set:
 *
 *     cost   0.0   0.2   0.3   0.5   1.0   1.2   2.0   3.0   5.0   10.0
 *     +freq  69.8  69.8  70.7  70.7  71.1  71.1  71.5  71.5  70.7  70.7
 *     rules  56.6  57.0  58.3  57.4  57.9  58.3  57.9  59.1  59.1  55.8
 *
 * 1.2 is chosen from the wide flat region rather than from the maximum, which
 * is a one-word difference on a 240-word set. The ceiling on the choice is not
 * the sweep: the strongest single letter-choice penalty in the table is around
 * 1.4 nats, so a cost much above that stops being a prior and becomes a hard
 * longest-match rule — which is what the collapse at 10.0 is.
 */
const UNIT_COST = 1.2;

/**
 * How candidates are generated and ranked.
 *
 *   * `walk` — the beam alone, ranked by its own P(fa | latin) plus the
 *     frequency and lexicon bonuses. What shipped before the dictionary.
 *   * `channel` — the beam's candidates *plus* every frequency-table word with
 *     the input's consonant skeleton, all ranked by the noisy channel in
 *     `dictionary.ts`: log P(latin | fa) + `frequency` x table score, with words
 *     outside the table backing off to the beam's own relative score.
 */
export interface ScoringParams {
  mode: "walk" | "channel";
  /** Weight on the frequency table's log-quantized score, channel mode. */
  frequency: number;
  /** Constant added to a candidate absent from the frequency table, channel mode. */
  outOfTable: number;
  /** Weight on the beam's score relative to its best, for out-of-table candidates. */
  walk: number;
  /** Prior probability of an unwritten short vowel, per Latin vowel. */
  insertion: number;
  /** Log cost of a doubled Latin consonant Persian does not write. */
  gemination: number;
  /** Skeleton-bucket words scored per input word, most frequent first. */
  bucket: number;
  /** Beam candidates carried into channel scoring, best first. */
  beamCarry: number;
  /** Log cost per stripped affix for a composed candidate; `-Infinity` disables morphology. */
  affix: number;
  /** Skeleton-bucket stems scored per decomposition. */
  stemBucket: number;
  /**
   * Log-odds tilt on a candidate that is another candidate plus a trailing ه,
   * applied in the sentence pass where the word's position is known: toward the
   * ه reading when nothing but punctuation follows the word, away from it when
   * another word does. See `Pipeline.finalHePass`.
   */
  finalHe: number;
  /**
   * Channel distributions re-estimated from data (`scripts/fit-channel.ts`),
   * replacing the ones derived from `src/rules.ts`. Unset: the table's.
   */
  fitted?: FittedChannel | undefined;
}

/**
 * Channel-mode constants. **Tuned on `data/dev/dev.jsonl` and
 * `data/fixtures/` together — never on gold** — with `scripts/sweep.ts`,
 * choosing from flat regions rather than maxima. On the dev set as first built
 * (167 rows; the adjudicated 137 came later and moved nothing below):
 *
 *     mode                 walk 48.8   channel 52.2 strict    fixtures 74.9 / 79.6
 *     insertion            0.1 49.3    0.25 52.3    0.5 52.3   1 50.7   2 49.6   4 48.0
 *     outOfTable, walk     flat over -4..-2 and 0.5..1; walk 1 is +1.0 on fixtures
 *     frequency            flat 4..8 once the channel carries the letter evidence
 *     bucket, beamCarry    flat over 16..256 and 24..48; 8 carried loses 0.1
 *
 * `insertion` is the one that matters, and it runs the opposite way to the
 * intuition that motivated it: charging an unwritten short vowel *more* than a
 * written ا is what the data wants, because real typists write `a` for ا far
 * more often than they write it for nothing.
 *
 * `affix` is `-Infinity`: morphology (`morph.ts`) is built, tested and off.
 * After fixing how composed candidates are scored it measured 63.2 / 63.2 /
 * 63.2 / 63.1 / 62.8 strict at off / -4 / -3 / -2 / -1 — nothing to buy at any
 * cost, and a way to lose at the cheap end.
 *
 * `finalHe` is applied by `Pipeline.finalHePass`, not here, because only the
 * sentence pass knows where a word sits. Swept on dev and the fixtures, as
 * fixture word accuracy at each tier:
 *
 *     finalHe   0     1     1.5   2     2.5   3     4     5     6
 *     rules     83.4  84.0  84.3  84.3  84.3  84.3  84.3  83.7  84.0
 *     hybrid    92.2  92.5  92.8  92.8  92.8  92.8  93.1  93.1  92.8
 *     model     91.5  91.5  91.5  91.5  91.5  91.2  91.5  90.9  90.6
 *
 * 2.0 is the interior of the region flat on all three, not any one tier's peak:
 * rules are flat over 1.5-4, hybrid keeps rising to 4, and the model tier is
 * the one that loses above 2. Past 4 it stops being a prior and starts being a
 * rule — `برایه` is only 3.1 nats behind `برای`, so a large enough term writes
 * one — and every tier falls back.
 *
 * It is **one-sided**, and that was measured rather than assumed. Tilting *away*
 * from a clitic ه mid-sentence, which is the symmetric term the same argument
 * suggests, is monotonically harmful: at 0.5 / 1 / 2 / 3 / 4 nats of medial
 * penalty the rules tier reads 69.0 / 68.3 / 67.8 / 67.5 / 67.3 dev-faithful
 * against 69.4 with none. The engine's medial ه calls are mostly already right
 * — خانه, پنجره, حمله — so there is nothing there to win and words to lose.
 *
 * What it buys at 2.0 is small and unevenly spread: rules +0.9 on the fixtures
 * and +0.1 on dev-faithful, hybrid +0.6 and +0.0, the shipped model tier +0.0
 * and +0.1. The reason it cannot buy more is the frequency term it argues with.
 * `خوبه`, `چطوره` and `بازه` are all in the frequency table, 1.2 to 1.7 nats
 * behind their bare spellings, and 2.0 nats reaches them. `کتابه` is *not* in
 * the table, so it pays `outOfTable` and forfeits کتاب's 0.69 — about 5.5 nats,
 * which nothing safe reaches. Noun-plus-copula is therefore still wrong
 * (`data/fixtures` ezafe-002, deliberately left failing), and fixing that class
 * is a frequency-table or morphology job, not a ranking one.
 */
export const SCORING: ScoringParams = {
  mode: "channel",
  frequency: 5.0,
  outOfTable: -2.0,
  walk: 1.0,
  insertion: 0.5,
  gemination: Math.log(0.3),
  bucket: 32,
  beamCarry: 24,
  affix: -Infinity,
  stemBucket: 8,
  finalHe: 2.0,
  fitted: FITTED_CHANNEL,
};

export class RuleBaseline {
  private readonly table: ReverseTable;
  private readonly lexicon: ReadonlySet<string> | undefined;
  private readonly frequency: FrequencyTable | undefined;
  private readonly scoring: ScoringParams;
  private readonly channel: Channel | undefined;
  private readonly index: SkeletonIndex | undefined;

  constructor(options: {
    lexicon?: ReadonlySet<string>;
    frequency?: FrequencyTable;
    scoring?: Partial<ScoringParams>;
  } = {}) {
    this.table = buildReverseTable();
    this.lexicon = options.lexicon;
    this.frequency = options.frequency;
    this.scoring = { ...SCORING, ...options.scoring };
    // The dictionary is built from the frequency table, so without one there is
    // nothing to index and channel mode degrades to the beam.
    if (this.scoring.mode === "channel" && options.frequency) {
      this.channel = this.scoring.fitted
        ? Channel.fromFitted(this.scoring.fitted, this.scoring)
        : new Channel(this.scoring);
      this.index = new SkeletonIndex(options.frequency);
    }
  }

  transliterate(word: string, options: BaselineOptions = {}): BaselineCandidate[] {
    const opts = { ...DEFAULTS, ...options };
    const lexicon = options.lexicon ?? this.lexicon;
    const lower = word.toLowerCase();
    if (!lower) return [];

    const frequency = options.frequency ?? this.frequency;
    if (this.channel && this.index && frequency === this.frequency) {
      return this.rankByChannel(lower, opts);
    }
    const segmentations = segment(lower, opts.maxSegmentations);
    const pool = new Map<string, BaselineCandidate>();

    for (const units of segmentations) {
      for (const candidate of this.walk(units, opts.beamWidth)) {
        const attested = lexicon?.has(candidate.output) ?? false;
        const frequent = frequencyScore(frequency, candidate.output);
        const score =
          candidate.score + (attested ? LEXICON_BONUS : 0) + FREQUENCY_BONUS * frequent;
        const reason = frequent > 0
          ? `rules(${units.join("·")}) + freq ${(frequent * 100).toFixed(0)}`
          : attested
            ? `rules(${units.join("·")}) + attested`
            : `rules(${units.join("·")})`;
        const existing = pool.get(candidate.output);
        if (!existing || score > existing.score) {
          pool.set(candidate.output, { output: candidate.output, score, reason });
        }
      }
    }

    return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, opts.results);
  }

  /**
   * Channel mode: beam candidates and skeleton-bucket words, one scale.
   *
   * The beam is still run — it is the only source of out-of-table spellings,
   * which is every inflection the 25k table did not count — but it is asked for
   * its raw walk score only, without the frequency bonus, because the channel
   * score below adds frequency once.
   */
  private rankByChannel(lower: string, opts: typeof DEFAULTS & BaselineOptions): BaselineCandidate[] {
    const p = this.scoring;
    const channel = this.channel!;
    const index = this.index!;

    const walked = new Map<string, number>();
    for (const units of segment(lower, opts.maxSegmentations)) {
      for (const candidate of this.walk(units, opts.beamWidth)) {
        if ((walked.get(candidate.output) ?? -Infinity) < candidate.score) walked.set(candidate.output, candidate.score);
      }
    }
    const beam = [...walked].sort((a, b) => b[1] - a[1]).slice(0, p.beamCarry);
    const walkBest = beam[0]?.[1] ?? 0;

    const scored = new Map<string, BaselineCandidate>();
    const keep = (candidate: BaselineCandidate) => {
      const existing = scored.get(candidate.output);
      if (!existing || candidate.score > existing.score) scored.set(candidate.output, candidate);
    };
    const consider = (output: string, walkScore: number | undefined, source: string) => {
      if (scored.has(output)) return;
      const inTable = index.frequency.get(output) ?? 0;
      const fit = channel.score(lower, output);
      let score: number;
      let reason: string;
      if (fit === -Infinity) {
        // No alignment: a pass-through the table cannot explain. Kept, last.
        score = -1e6 + (walkScore ?? -1e6);
        reason = `rules(${source}) unaligned`;
      } else if (inTable > 0) {
        score = fit + p.frequency * inTable;
        reason = `channel ${fit.toFixed(2)} + freq ${(inTable * 100).toFixed(0)} (${source})`;
      } else {
        score = fit + p.outOfTable + p.walk * ((walkScore ?? walkBest) - walkBest);
        reason = `channel ${fit.toFixed(2)}, not in table (${source})`;
      }
      keep({ output, score, reason });
    };

    for (const [output, walkScore] of beam) consider(output, walkScore, "beam");
    for (const word of index.lookup(lower, p.bucket)) consider(word, walked.get(word), "dictionary");
    // Outside candidates the beam never produced are scored as its worst
    // carried candidate on the walk term: no evidence for them, none against.
    const walkWorst = beam[beam.length - 1]?.[1] ?? walkBest;
    for (const output of opts.extra ?? []) consider(output, walked.get(output) ?? walkWorst, "model");

    // Morphology: an inflected form scored as its stem's table entry, plus a
    // fixed cost per affix. Only table stems are composed — an out-of-table
    // stem plus affixes is just a worse beam candidate.
    if (p.affix > -Infinity) {
      for (const parts of decompose(lower)) {
        const cost = p.affix * (parts.suffixes.length + (parts.prefix ? 1 : 0));
        for (const stem of index.lookup(parts.stem, p.stemBucket)) {
          // The channel scores the whole input against the whole composed
          // word, so affix letters are charged like any others; only the
          // frequency is borrowed from the stem. Scoring the stem alone left
          // the affix letters free, and `begam` became be+گام over بگم.
          const output = compose(parts.prefix, stem, parts.suffixes);
          if (scored.has(output) && index.frequency.has(output)) continue;
          const fit = channel.score(lower, output);
          if (fit === -Infinity) continue;
          const affixes = [parts.prefix?.latin, ...parts.suffixes.map((x) => x.latin)].filter(Boolean).join("+");
          keep({
            output,
            score: fit + p.frequency * index.frequency.get(stem)! + cost,
            reason: `morph ${stem}+${affixes}, channel ${fit.toFixed(2)}`,
          });
        }
      }
    }

    return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, opts.results);
  }

  /** Beam over the units of one segmentation. */
  private walk(units: readonly string[], width: number): BaselineCandidate[] {
    let beam: BaselineCandidate[] = [{ output: "", score: 0, reason: "" }];

    for (let i = 0; i < units.length; i++) {
      const position = positionOf(i, units.length);
      const choices = this.table.get(units[i]!)?.get(position) ?? [];
      const next: BaselineCandidate[] = [];

      if (choices.length === 0) {
        // No rule covers this unit. Pass it through rather than dropping it, so
        // the failure is visible in the output instead of silently truncating.
        for (const partial of beam) {
          next.push({
            output: partial.output + units[i]!,
            score: partial.score - 6 - UNIT_COST,
            reason: "",
          });
        }
      } else {
        const total = choices.reduce((sum, c) => sum + c.w, 0);
        for (const partial of beam) {
          for (const choice of choices) {
            next.push({
              output: partial.output + choice.fa,
              score: partial.score + Math.log(choice.w / total) - UNIT_COST,
              reason: "",
            });
          }
        }
      }

      beam = dedupe(next).sort((a, b) => b.score - a.score).slice(0, width);
    }
    return beam;
  }
}

function dedupe(candidates: BaselineCandidate[]): BaselineCandidate[] {
  const best = new Map<string, BaselineCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.output);
    if (!existing || c.score > existing.score) best.set(c.output, c);
  }
  return [...best.values()];
}

/** Convenience for lexicon construction: fold every entry to its match key. */
export function matchKeySet(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const word of words) out.add(foldForMatch(word));
  return out;
}

void (undefined as unknown as Correspondence);

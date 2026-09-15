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

import { frequencyScore, type FrequencyTable } from "./frequency.ts";
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

export class RuleBaseline {
  private readonly table: ReverseTable;
  private readonly lexicon: ReadonlySet<string> | undefined;
  private readonly frequency: FrequencyTable | undefined;

  constructor(options: { lexicon?: ReadonlySet<string>; frequency?: FrequencyTable } = {}) {
    this.table = buildReverseTable();
    this.lexicon = options.lexicon;
    this.frequency = options.frequency;
  }

  transliterate(word: string, options: BaselineOptions = {}): BaselineCandidate[] {
    const opts = { ...DEFAULTS, ...options };
    const lexicon = options.lexicon ?? this.lexicon;
    const lower = word.toLowerCase();
    if (!lower) return [];

    const frequency = options.frequency ?? this.frequency;
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

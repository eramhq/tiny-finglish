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
  /** Attested Persian words. Membership is the strongest ranking signal there is. */
  lexicon?: ReadonlySet<string> | undefined;
  /** Segmentations of the Latin string to explore. */
  maxSegmentations?: number;
}

const DEFAULTS = {
  beamWidth: 24,
  results: 3,
  maxSegmentations: 8,
};

/** Log-odds bonus for an output that is an attested Persian word. */
const LEXICON_BONUS = 4.0;

export class RuleBaseline {
  private readonly table: ReverseTable;
  private readonly lexicon: ReadonlySet<string> | undefined;

  constructor(options: { lexicon?: ReadonlySet<string> } = {}) {
    this.table = buildReverseTable();
    this.lexicon = options.lexicon;
  }

  transliterate(word: string, options: BaselineOptions = {}): BaselineCandidate[] {
    const opts = { ...DEFAULTS, ...options };
    const lexicon = options.lexicon ?? this.lexicon;
    const lower = word.toLowerCase();
    if (!lower) return [];

    const segmentations = segment(lower, opts.maxSegmentations);
    const pool = new Map<string, BaselineCandidate>();

    for (const units of segmentations) {
      for (const candidate of this.walk(units, opts.beamWidth)) {
        const attested = lexicon?.has(candidate.output) ?? false;
        const score = candidate.score + (attested ? LEXICON_BONUS : 0);
        const reason = attested
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
          next.push({ output: partial.output + units[i]!, score: partial.score - 6, reason: "" });
        }
      } else {
        const total = choices.reduce((sum, c) => sum + c.w, 0);
        for (const partial of beam) {
          for (const choice of choices) {
            next.push({
              output: partial.output + choice.fa,
              score: partial.score + Math.log(choice.w / total),
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

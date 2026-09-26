/**
 * The model-independent half of the pipeline.
 *
 * Everything here — tokenizing, span assembly, the per-word memo, the rule
 * baseline, the sentence pass and its Viterbi — runs without a byte of neural
 * runtime. It lives in its own module so that it can be *bundled* without one.
 * `Transliterator` builds a `Transducer` in its constructor, which makes
 * `quant.ts` and `runtime.ts` unconditional imports of `index.ts`; no bundler
 * can tree-shake them away for a consumer who never passes `model`. Measured
 * with `node scripts/size.ts --tiers`, that is the difference between 9.1 KiB
 * and 5.2 KiB Brotli.
 *
 * `Transliterator` extends this and overrides one method. `RuleTransliterator`
 * in `rules-engine.ts` extends it and overrides nothing, which is the point:
 * the rules-only tier is the same pipeline, not a reduced copy of it that could
 * drift.
 */

import { RuleBaseline, SCORING, type ScoringParams } from "./baseline.ts";
import { bigramScore, type BigramTable } from "./bigram.ts";
import { type FrequencyTable } from "./frequency.ts";
import { loanwordSpellings } from "./loan.ts";
import { normalize } from "./normalize.ts";
import { restretch, unstretch } from "./stretch.ts";
import { tokenize, type Token } from "./tokenize.ts";
import { vowelPass, type VowelTable } from "./vowels.ts";
import type {
  Candidate,
  Span,
  TransliterateOptions,
  TransliterationResult,
} from "./types.ts";

export interface PipelineOptions {
  /**
   * Attested Persian words. Used to rank rule-baseline candidates, and — only
   * when `useLexiconSnap` is on — to rerank model output.
   */
  lexicon?: ReadonlySet<string>;
  /**
   * Word frequencies, from `decodeFrequencyTable`. Used to rerank candidates:
   * the model says which spellings are plausible, this says which are likely.
   */
  frequency?: FrequencyTable;
  /**
   * Word bigrams, from `decodeBigramTable`. Turns step [5] from a lexicon
   * tie-break into a Viterbi pass over the whole sentence. Optional and a
   * separate fetch, like the frequency table.
   */
  bigram?: BigramTable;
  /**
   * Vowels of the words a typed `a` cannot tell apart, from
   * `decodeVowelTable`. Reorders سلام against سالم for `salam`, on every tier.
   * Optional and a separate fetch, like the frequency table.
   */
  vowels?: VowelTable;
  /** Words cached on the incremental typing path. */
  cacheSize?: number;
  /**
   * Override the rule baseline's candidate scoring. For ablations and tuning
   * sweeps; the defaults in `SCORING` are what ships.
   */
  scoring?: Partial<ScoringParams>;
}

/** U+200C. Meaningful inside a Persian word; inert anywhere else. */
export const ZWNJ = "\u200C";

/**
 * Weight on bigram association in the sentence pass.
 *
 * The per-candidate generation score is a log probability over the candidates
 * for one span; the bigram term is a normalized PMI in [0,1]. This constant is
 * what puts them on one scale, so it is not a free knob so much as a unit
 * conversion with a confidence attached. Tuned on `data/fixtures/` only.
 */
const BIGRAM_WEIGHT = 6.0;

/**
 * Candidates per span the sentence pass gets to choose between.
 *
 * Independent of `candidatesPerSpan`, which is how many are *reported*. A
 * reranker with three options cannot reach the ceiling `scripts/oracle.ts`
 * measures at eight, and widening the reported list instead would change the
 * shape of every `Span` for callers who never asked for a language model.
 */
const CONTEXT_CANDIDATES = 8;

/**
 * Plural and comparative suffixes typed as their own word: `mahaarat haaye`,
 * `zood tar`. Joined to the word before, solid, because that is how the Persian
 * side of both real evaluation sets writes them (مهارتهای, زودتر) and because a
 * detached ها is two word errors against it, not one.
 *
 * This is an orthographic convention, and it is reported as one: on dev it
 * moves strict word accuracy +6.3 and the orthographic tier, which already
 * folds the join, only +1.5. The standard written form is ZWNJ-joined
 * (کتاب‌ها); the rule engine's no-ZWNJ convention is kept here for the same
 * reason as in `SkeletonIndex`.
 */
const DETACHED_SUFFIX = /^(h[aā]{1,2}(ye|yi|ei|yam|yat|yash|yeshaan|yetaan|yemaan|yeman|yeshan)?|tar|tarin)$/;

const DEFAULT_OPTIONS: Required<Pick<TransliterateOptions,
  "alternatives" | "beamWidth" | "candidatesPerSpan" | "persianPunctuation" | "backend">> = {
  alternatives: 3,
  beamWidth: 8,
  candidatesPerSpan: 3,
  persianPunctuation: true,
  backend: "auto",
};

export abstract class Pipeline {
  protected readonly baseline: RuleBaseline;
  protected readonly lexicon: ReadonlySet<string> | undefined;
  protected readonly frequency: FrequencyTable | undefined;
  protected readonly bigram: BigramTable | undefined;
  protected readonly vowels: VowelTable | undefined;
  /**
   * The same constants the baseline ranks with; `vowelAgreement` and `finalHe`
   * are the terms applied here, after whichever engine generated the list.
   */
  protected readonly scoring: ScoringParams;
  /**
   * Word-level memo. This is what keeps the typing path inside a 16 ms frame:
   * a keystroke re-converts only the word being edited, never the sentence.
   */
  private readonly cache = new Map<string, Candidate[]>();
  private readonly cacheSize: number;

  constructor(options: PipelineOptions = {}) {
    this.lexicon = options.lexicon;
    this.frequency = options.frequency;
    this.bigram = options.bigram;
    this.vowels = options.vowels;
    this.cacheSize = options.cacheSize ?? 2048;
    this.scoring = { ...SCORING, ...options.scoring };
    this.baseline = new RuleBaseline({
      ...(options.lexicon ? { lexicon: options.lexicon } : {}),
      ...(options.frequency ? { frequency: options.frequency } : {}),
      ...(options.scoring ? { scoring: options.scoring } : {}),
    });
  }

  /** True when a learned model is driving conversion rather than the rules. */
  get hasModel(): boolean {
    return false;
  }

  /** True when step [5] has sentence context to work with. */
  get hasContext(): boolean {
    return this.bigram !== undefined;
  }

  /**
   * Candidates for one word — the single seam a model plugs into.
   *
   * The base implementation is the rule baseline, which is also what
   * `Transliterator` falls back to when no weights are supplied.
   */
  protected convertWord(word: string, opts: TransliterateOptions): Candidate[] {
    return this.convertWithRules(word, opts);
  }

  transliterate(input: string, options: TransliterateOptions = {}): TransliterationResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const tokens = tokenize(input, {
      protect: options.protect ?? [],
      forceConvert: options.forceConvert ?? [],
    });

    const spans: Span[] = [];
    for (const token of tokens) {
      spans.push(this.spanFor(token, opts));
    }

    const attach = this.detachedEzafe(spans);
    this.sentencePass(spans);
    for (const index of attach) this.appendYe(spans[index]!);
    // Trim to the reported width only after the sentence pass, which needs a
    // wider list than a caller asked to see.
    for (const span of spans) {
      if (span.candidates) span.candidates = span.candidates.slice(0, opts.candidatesPerSpan);
    }

    const text = spans.map((s) => s.output).join("");
    const converted = spans.filter((s) => s.action === "convert");
    const confidence = converted.length
      ? Math.exp(converted.reduce((sum, s) => sum + Math.log(Math.max(s.confidence, 1e-9)), 0) / converted.length)
      : 1;

    return {
      text,
      alternatives: this.alternatives(spans, opts.alternatives),
      confidence: round4(confidence),
      spans,
    };
  }
  // -- detached ezafe ------------------------------------------------------

  /**
   * Resolve affixes typed as their own word: the detached plural and
   * comparative (see `DETACHED_SUFFIX`), and the ezafe — `sal e do hezar`, `ha ye
   * mokhtalef`, `bara ye zamin`.
   *
   * Many typists write the ezafe vowel as a separate token, and converted as a
   * word it becomes a spurious و or یه in the middle of a phrase. Persian does
   * not write the ezafe after a consonant at all, and writes it as ی joined to
   * a word ending in ا or و — `های`, `برای`, `روی`. So, when the token follows a
   * converted word across one space:
   *
   *   * `e` or `ie` is dropped, with the space before it;
   *   * `ye` after a word whose Latin ends in a vowel is dropped the same way,
   *     and its word gets a ی if its Persian ends in ا or و (not after ی: `zendegi ye`
   *     is زندگی, not زندگیی). After a silent he nothing is added either:
   *     `khaane ye bozorg` is the ezafe خانهٔ بزرگ, which both real evaluation
   *     sets write خانه بزرگ. The colloquial "one" comes *before* its noun —
   *     `ye bache`, not `bache ye` — which is why this cannot eat it. After a consonant,
   *     or with no word before it, `ye` is the colloquial یه ("one") and is left
   *     alone: `ye maadar`, `shohar jaan ye daste gol`.
   *
   * Measured on the dev set, where it was found; the fixtures carry separate
   * cases. Returns the spans that need their ی appended after the sentence
   * pass, which may still change their output.
   */
  private detachedEzafe(spans: Span[]): number[] {
    const attach: number[] = [];
    for (let i = 2; i < spans.length; i++) {
      const span = spans[i]!;
      const gap = spans[i - 1]!;
      const previous = spans[i - 2]!;
      if (span.action !== "convert" || gap.action !== "space" || previous.action !== "convert") continue;
      if (gap.input !== " ") continue;
      const token = span.input.toLowerCase();
      if (DETACHED_SUFFIX.test(token)) {
        gap.output = "";
        continue;
      }
      const vowelFinal = /[aeiou]$/.test(previous.input.toLowerCase());
      if (token === "e" || token === "ie" || (token === "ye" && vowelFinal)) {
        gap.output = "";
        span.output = "";
        span.confidence = 1;
        span.candidates = [{ output: "", probability: 1, reason: "detached ezafe, unwritten" }];
        if (token === "ye") attach.push(i - 2);
      }
    }
    return attach;
  }

  private appendYe(span: Span): void {
    if (!/[او]$/u.test(span.output)) return;
    span.output += "ی";
    span.candidates = span.candidates?.map((c) => ({ ...c, output: /[او]$/u.test(c.output) ? `${c.output}ی` : c.output }));
  }

  // -- per-token ----------------------------------------------------------

  private spanFor(token: Token, opts: typeof DEFAULT_OPTIONS & TransliterateOptions): Span {
    const base = { input: token.text, start: token.start, end: token.end };

    if (token.kind === "protected") {
      return { ...base, output: token.text, action: "copy", confidence: 1, copyReason: token.reason! };
    }
    if (token.kind === "space") {
      return { ...base, output: token.text, action: "space", confidence: 1 };
    }
    if (token.kind === "punct") {
      const output = opts.persianPunctuation
        ? normalize(token.text, { punctuation: true, digits: "preserve" })
        : token.text;
      return { ...base, output, action: "punct", confidence: 1 };
    }

    const candidates = this.convert(token.text, opts);
    const best = candidates[0];
    return {
      ...base,
      output: best?.output ?? token.text,
      action: "convert",
      confidence: round4(best?.probability ?? 0),
      // Sliced after `sentencePass`, not here.
      candidates: [...candidates],
    };
  }

  /**
   * Candidates for one word, stretch included. A stretched word is converted
   * without its stretch, under the collapsed memo key, and a word-final stretch
   * is put back on every candidate afterwards (`stretch.ts`).
   */
  protected convert(word: string, opts: TransliterateOptions): Candidate[] {
    const { base, final } = unstretch(word.toLowerCase());
    const candidates = this.convertBase(base, opts);
    if (!final) return candidates;
    return candidates.map((c) => {
      const output = restretch(c.output, final);
      return output === c.output ? c : { ...c, output, reason: `${c.reason}, stretched` };
    });
  }

  private convertBase(key: string, opts: TransliterateOptions): Candidate[] {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const wide = this.bigram
      ? { ...opts, candidatesPerSpan: Math.max(opts.candidatesPerSpan ?? 3, CONTEXT_CANDIDATES) }
      : opts;
    // Vowel agreement is context-free, so it is applied before the memo and
    // cached with the list — and applied here rather than in the baseline so
    // the model and hybrid tiers get it too. The model tier is where it matters
    // most: v7 writes `salam` as سالم without it.
    const generated = this.convertWord(key, wide);
    const candidates = withLoanword(key, this.vowels
      ? vowelPass(key, generated, this.vowels, this.scoring.vowelAgreement)
      : generated);

    if (this.cache.size >= this.cacheSize) {
      // Cheap FIFO eviction. A true LRU costs more bookkeeping than it saves at
      // this hit rate, since the working set while typing is a few dozen words.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, candidates);
    return candidates;
  }

  protected convertWithRules(word: string, opts: TransliterateOptions): Candidate[] {
    const results = this.baseline.transliterate(word, {
      results: Math.max(opts.candidatesPerSpan ?? 3, 3),
    });
    if (results.length === 0) {
      return [{ output: word, probability: 0, reason: "no rule matched; copied" }];
    }
    const max = Math.max(...results.map((r) => r.score));
    const weights = results.map((r) => Math.exp(r.score - max));
    const total = weights.reduce((a, b) => a + b, 0);
    return results.map((r, i) => ({
      output: normalize(r.output),
      probability: round4(weights[i]! / total),
      reason: r.reason,
    }));
  }

  /**
   * Step [5] — the sentence-level pass.
   *
   * With a bigram table, a Viterbi decode over the per-span candidate lists.
   * Without one, the lexicon tie-break that was here before it: promote an
   * attested alternative over an unattested best guess when the two are close.
   *
   * **The word memo does not need invalidating, and that is the whole design.**
   * `convert()` caches *candidate generation*, which is context-free and stays
   * context-free; the sentence pass only reorders a cached list. Keeping a
   * lattice cache instead would mean invalidating on every keystroke, and the
   * lattice is far cheaper to recompute than to invalidate correctly — a warm
   * 15-word sentence including this pass measures 0.02 ms against a 16 ms
   * frame, so there is nothing to save.
   *
   * What this can buy is bounded and was measured before it was built:
   * `scripts/oracle.ts` puts a *perfect* reranker at +9.6 points on the gold
   * set, because 20.3% of reference words are never in the candidate list at
   * all. The roadmap previously assumed a much larger number, from prior art
   * whose candidate generator was a pair 6-gram FST rather than this beam.
   */
  protected sentencePass(spans: Span[]): void {
    this.finalHePass(spans);
    if (this.bigram) this.contextPass(spans);
    if (!this.lexicon) return;
    for (const span of spans) {
      if (span.action !== "convert" || !span.candidates || span.candidates.length < 2) continue;
      const best = span.candidates[0]!;
      // A frequency-table word is attested too. Without this the tie-break
      // undid right answers the lexicon lacks — v7 ranked کتابه first for
      // `ketabe` and this swapped it back to the stem کتاب.
      if (this.lexicon.has(best.output) || this.frequency?.has(best.output)) continue;
      const attested = span.candidates.find((c) => this.lexicon!.has(c.output));
      // Only override a genuinely uncertain call. A confident model answer that
      // is simply not in a 100k-stem lexicon is usually an inflected form, not
      // a mistake, and overriding it would be worse than leaving it.
      if (attested && best.probability - attested.probability < 0.25) {
        span.output = attested.output;
        span.confidence = round4(attested.probability);
        span.candidates = [attested, ...span.candidates.filter((c) => c !== attested)];
      }
    }
  }

  /**
   * The word-final ه decision, with the one piece of context it needs.
   *
   * `ketaabe` is کتاب or کتابه, `khoobe` is خوب or خوبه, and the rule baseline
   * decides between them on `fit + frequency` alone (`baseline.ts`), which is
   * the same answer for `ketaabe` and for `ketaabe man`. It is the wrong shape
   * of evidence: the ه here is a clitic — the copula است and the colloquial
   * ezafe — and a clitic attaches at the end of a phrase, not in front of the
   * next word. The engine got `in ketaabe` -> این کتاب and `havaa khoobe` ->
   * هوا خوب for exactly that reason.
   *
   * So this tilts, and only tilts. It cannot be a rule: خانه and پرنده keep
   * their ه wherever they stand (`khane bozorg ast` -> خانه بزرگ است), so
   * position is evidence about the ه, not a decision about it.
   *
   * At a clause end, **every** ه-final candidate gets `scoring.finalHe` nats and
   * the list is renormalized and reordered. Applying it to all of them, rather
   * than to the ones that happen to have their bare form in the list too, is
   * what keeps two ه spellings in their original order relative to each other —
   * they are scaled by the same factor, so only ه-final against bare moves.
   *
   * That was learned the hard way. The first version required a pair: a
   * candidate qualified only if its own bare form was also a candidate. It broke
   * `gozashte` into گذاشته, because گذاشت was in the list to make گذاشته look
   * like a clitic pair while گذشت was not, so the bonus landed on one of the two
   * ه spellings and not the other. A pairwise swap fixed that but could not
   * reach a ه form sitting behind a *third* candidate, which is most of them.
   * Scaling the whole class has both properties and needs no pair bookkeeping.
   * A list that is all ه-final, or none, is skipped: uniform scaling would not
   * reorder anything.
   *
   * A per-candidate borrow once sat on top of this — an out-of-table ه form
   * took its bare form's frequency (`heBorrow`) — to reach کتابه. It is gone:
   * the chat supplement put the copula forms in the frequency table itself, and
   * the borrow then bought nothing on any tier (`SCORING` has the sweep).
   *
   * **The mirror half of that is not here, because it does not work.** Charging
   * a clitic ه mid-sentence is the obvious other half and it loses steadily —
   * the sweep is in `SCORING`. Medial is where خانه and پرنده live, the engine
   * already gets most of them right, and there is no way to penalize the ه
   * there without breaking them. Only the clause-final position is
   * systematically wrong, so only the clause-final position is touched.
   *
   * Running here rather than in `convertWord` is what keeps the word memo
   * context-free: candidate *generation* is still a pure function of the word,
   * and this only reweights the cached list. On the typing path that means a
   * word can change under the cursor — `khoobe` shows خوبه while it is the last
   * word and becomes خوب once another follows it. That is the term working, not
   * flicker: the evidence genuinely changed.
   *
   * The ceiling on the whole idea is small and was measured before it was
   * built. An oracle allowed to flip nothing but ه-pairs — pick the right
   * member of every pair the engine offers — is worth +0.6 on dev-faithful and
   * +0.3 on the fixtures; letting it also insert or delete a ه the candidate
   * list never proposed adds only +0.2 more. Candidate generation is not the
   * limit here, ranking is, and the ranking is 538 pairs deep on dev of which
   * just 34 are clause-final.
   */
  private finalHePass(spans: Span[]): void {
    const weight = this.scoring.finalHe;
    if (!weight) return;
    const gain = Math.exp(weight);
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const list = span.candidates;
      if (span.action !== "convert" || !list || list.length < 2) continue;
      if (!endsClause(spans, i)) continue;
      const scaled = list.map((candidate) => ({
        candidate,
        he: candidate.output.length > 1 && candidate.output.endsWith("ه"),
      }));
      if (scaled.every((s) => s.he) || !scaled.some((s) => s.he)) continue;
      const weights = scaled.map(({ candidate, he }) =>
        Math.max(candidate.probability, 1e-6) * (he ? gain : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      const ranked = scaled
        .map(({ candidate, he }, k) => ({ candidate, he, weight: weights[k]! }))
        .sort((a, b) => b.weight - a.weight)
        .map(({ candidate, he, weight: w }) => ({
          ...candidate,
          probability: round4(w / total),
          reason: he ? `${candidate.reason} +${weight.toFixed(2)} clause-final ه` : candidate.reason,
        }));
      span.candidates = ranked;
      span.output = ranked[0]!.output;
      span.confidence = ranked[0]!.probability;
    }
  }

  /**
   * Viterbi over one run of adjacent convertible spans.
   *
   * Spans are conditionally independent given their candidate lists, so this is
   * a small dynamic program rather than a search: `slots x k x k` additions,
   * about 960 for a fifteen-word sentence at k=8.
   *
   * The chain breaks at punctuation and at copy spans. A URL or an English word
   * is not a Persian word, and letting one become a bigram context would leak
   * the tokenizer's protected spans into the language model; a full stop ends a
   * sentence, which is the unit the model was counted over. Runs of whitespace
   * do not break it — a space is what separates two words in the first place.
   */
  private contextPass(spans: Span[]): void {
    let run: Span[] = [];
    const flush = () => {
      if (run.length > 1) this.viterbi(run);
      run = [];
    };
    for (const span of spans) {
      if (span.action === "convert" && span.candidates && span.candidates.length) run.push(span);
      else if (span.action !== "space") flush();
    }
    flush();
  }

  private viterbi(run: readonly Span[]): void {
    const lists = run.map((span) => span.candidates!);
    // Generation evidence, as a log probability. Floored rather than allowed to
    // reach -Infinity: a candidate rounded to probability 0 is still a
    // candidate, and the bigram term is exactly the evidence that might rescue
    // it.
    const emit = lists.map((list) => list.map((c) => Math.log(Math.max(c.probability, 1e-6))));

    let previous = emit[0]!.slice();
    const back: number[][] = [];

    for (let i = 1; i < lists.length; i++) {
      const row = lists[i]!;
      const scores = new Array<number>(row.length);
      const pointers = new Array<number>(row.length);
      for (let c = 0; c < row.length; c++) {
        let bestScore = -Infinity;
        let bestFrom = 0;
        for (let p = 0; p < previous.length; p++) {
          const score =
            previous[p]! +
            BIGRAM_WEIGHT * bigramScore(this.bigram, lists[i - 1]![p]!.output, row[c]!.output);
          if (score > bestScore) {
            bestScore = score;
            bestFrom = p;
          }
        }
        scores[c] = bestScore + emit[i]![c]!;
        pointers[c] = bestFrom;
      }
      back.push(pointers);
      previous = scores;
    }

    const path = new Array<number>(lists.length);
    let at = 0;
    for (let c = 1; c < previous.length; c++) if (previous[c]! > previous[at]!) at = c;
    path[lists.length - 1] = at;
    for (let i = lists.length - 1; i > 0; i--) {
      at = back[i - 1]![at]!;
      path[i - 1] = at;
    }

    run.forEach((span, i) => {
      const chosen = span.candidates![path[i]!]!;
      if (chosen === span.candidates![0]) return;
      span.output = chosen.output;
      span.confidence = round4(chosen.probability);
      span.candidates = [chosen, ...span.candidates!.filter((c) => c !== chosen)];
    });
  }

  /**
   * Whole-text alternatives, produced by varying the least-confident spans one
   * at a time rather than enumerating a cross product — the same reason the
   * baseline uses a beam.
   */
  private alternatives(spans: readonly Span[], limit: number): string[] {
    if (limit <= 0) return [];
    const varied = spans
      .map((span, index) => ({ span, index }))
      .filter(({ span }) => span.action === "convert" && (span.candidates?.length ?? 0) > 1)
      .sort((a, b) => a.span.confidence - b.span.confidence)
      .slice(0, limit);

    const base = spans.map((s) => s.output);
    const out: string[] = [];
    const seen = new Set([base.join("")]);
    for (const { span, index } of varied) {
      for (const candidate of span.candidates!.slice(1)) {
        const copy = [...base];
        copy[index] = candidate.output;
        const text = copy.join("");
        if (!seen.has(text)) {
          seen.add(text);
          out.push(text);
        }
        if (out.length >= limit) return out;
      }
    }
    return out;
  }
}

/**
 * The probability a loanword-table hit takes (`loan.ts`). The engine's own
 * candidates share the rest, so they stay in the list as alternatives, and the
 * gap is wide enough that neither the lexicon tie-break (0.25) nor the
 * clause-final ه tilt can put an engine spelling above the table's.
 */
const LOANWORD_SHARE = 0.9;

/**
 * Put the table's Persian first when `word` is a loanword-table word. A final
 * `e` gives two spellings, bare and with ه (`laptope`), and `finalHePass`
 * chooses between them by position, so the bare one leads.
 */
function withLoanword(word: string, engine: Candidate[]): Candidate[] {
  const spellings = loanwordSpellings(word);
  if (!spellings) return engine;
  const shares = spellings.length === 1 ? [1] : [0.6, 0.4];
  const loan = spellings.map((output, i) => ({
    output,
    probability: round4(LOANWORD_SHARE * shares[i]!),
    reason: "loanword",
  }));
  const rest = engine.filter((c) => !spellings.includes(c.output));
  const total = rest.reduce((sum, c) => sum + c.probability, 0) || 1;
  return [...loan, ...rest.map((c) => ({ ...c, probability: round4(((1 - LOANWORD_SHARE) * c.probability) / total) }))];
}

export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * True when nothing but punctuation follows `spans[i]` — the position a clitic
 * ه is written in. A comma counts: `havaa khoobe, vali sard ast` ends a clause
 * there as surely as a full stop does. A copy span does not — an English word
 * or a URL is still something following, and this is a claim about word order,
 * not about what the tokenizer could convert.
 */
function endsClause(spans: readonly Span[], i: number): boolean {
  for (let j = i + 1; j < spans.length; j++) {
    if (spans[j]!.action === "space") continue;
    return spans[j]!.action === "punct";
  }
  return true;
}

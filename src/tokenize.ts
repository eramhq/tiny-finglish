/**
 * Tokenizer and protected-span detector — step [1] of the pipeline.
 *
 * Entirely deterministic; no model runs here. Its job is to decide, for every
 * character of the input, whether it is Finglish to be converted or something
 * that must survive byte-identical. Regressions here are the fastest way to
 * lose users, so the fixture suite asserts byte-identity on every protected
 * class.
 */

import { englishness, FINGLISH_HOMOGRAPHS } from "./english.ts";
import { isLoanword } from "./loan.ts";
import { unstretch } from "./stretch.ts";
import type { CopyReason } from "./types.ts";

export type TokenKind = "word" | "space" | "punct" | "protected";

export interface Token {
  text: string;
  kind: TokenKind;
  start: number;
  end: number;
  /** Set when `kind === "protected"`. */
  reason?: CopyReason;
  /** A loanword-table word (`loan.ts`), bare or with Persian endings. */
  loanword?: boolean;
}

export interface TokenizeOptions {
  protect?: readonly string[];
  forceConvert?: readonly string[];
}

/**
 * Hard protected patterns, tried in order at each position. Order is
 * significant: a URL containing an `@` must win over the email rule, and an
 * email must win over the mention rule.
 */
const HARD_PATTERNS: ReadonlyArray<{ reason: CopyReason; re: RegExp }> = [
  // Fenced or inline code. Highest priority: the user asked for it verbatim.
  { reason: "code", re: /^`[^`]*`/u },
  // Scheme-qualified URL, or a bare domain with a known-ish TLD and no space.
  {
    reason: "url",
    re: /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()[\]{}"']+|^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|ir|co|app|ai|me|sh|xyz|edu|gov)(?:\/[^\s<>()[\]{}"']*)?/iu,
  },
  { reason: "email", re: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/iu },
  { reason: "mention", re: /^@[a-z0-9_.]{1,40}/iu },
  { reason: "hashtag", re: /^#[\p{L}\p{N}_]{1,60}/u },
  // Numbers, including decimals, thousands separators, ranges, percents and
  // anything with an attached unit-ish suffix.
  { reason: "number", re: /^[+-]?\d[\d,._:\/-]*\d%?|^[+-]?\d%?/u },
  // Identifiers: snake_case, kebab-in-code, camelCase, ALLCAPS, alphanumeric SKUs.
  { reason: "code", re: /^[A-Za-z][A-Za-z0-9]*(?:[_][A-Za-z0-9]+)+|^[a-z]+[A-Z][A-Za-z0-9]*|^[A-Z]{2,}[0-9]*(?![a-z])|^[A-Za-z]+\d+[A-Za-z0-9]*/u },
];

const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u{1F3FB}-\u{1F3FF}])*/u;
/** Any script that is not Latin and not punctuation — already-Persian text, CJK, Cyrillic. */
const NON_LATIN_RE = /^[^\p{Script=Latin}\p{P}\p{Z}\p{N}\p{C}]+/u;
const LATIN_WORD_RE = /^[A-Za-z]+(?:['’][A-Za-z]+)*/u;
const SPACE_RE = /^\s+/u;
const PUNCT_RE = /^[\p{P}\p{S}]+/u;

/** Threshold above which `englishness()` protects a token. */
const ENGLISH_THRESHOLD = 0.5;

export function tokenize(input: string, options: TokenizeOptions = {}): Token[] {
  const protectSet = new Set((options.protect ?? []).map((w) => w.toLowerCase()));
  const forceSet = new Set((options.forceConvert ?? []).map((w) => w.toLowerCase()));
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const rest = input.slice(i);
    let matched = false;

    for (const { reason, re } of HARD_PATTERNS) {
      const m = re.exec(rest);
      if (m && m[0].length > 0) {
        // A hard pattern never overrides an explicit forceConvert request.
        if (!forceSet.has(m[0].toLowerCase())) {
          push(tokens, m[0], "protected", i, reason);
          i += m[0].length;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    const emoji = EMOJI_RE.exec(rest);
    if (emoji) {
      push(tokens, emoji[0], "protected", i, "emoji");
      i += emoji[0].length;
      continue;
    }

    const nonLatin = NON_LATIN_RE.exec(rest);
    if (nonLatin) {
      push(tokens, nonLatin[0], "protected", i, "non-latin");
      i += nonLatin[0].length;
      continue;
    }

    const word = LATIN_WORD_RE.exec(rest);
    if (word) {
      const text = word[0];
      const lower = text.toLowerCase();
      const decision = classifyWord(text, lower, {
        protectSet,
        forceSet,
        atSentenceStart: isAtSentenceStart(tokens),
      });
      push(tokens, text, decision ? "protected" : "word", i, decision ?? undefined);
      if (!decision && !forceSet.has(lower) && isLoanword(unstretch(lower).base)) tokens.at(-1)!.loanword = true;
      i += text.length;
      continue;
    }

    const space = SPACE_RE.exec(rest);
    if (space) {
      push(tokens, space[0], "space", i);
      i += space[0].length;
      continue;
    }

    const punct = PUNCT_RE.exec(rest);
    if (punct) {
      push(tokens, punct[0], "punct", i);
      i += punct[0].length;
      continue;
    }

    // Nothing matched: emit one code point so the scanner always advances.
    const cp = String.fromCodePoint(input.codePointAt(i)!);
    push(tokens, cp, "punct", i);
    i += cp.length;
  }

  guardLoanwords(tokens);
  return tokens;
}

/**
 * A loanword stays English among English words.
 *
 * The table overrides the English detector, which is right in `tu instagram
 * pm bede` and wrong in `open google chrome` or `send the backup`: there the
 * words around it say the whole phrase is English. So a table word next to a
 * word the detector protects as English — across whitespace only — is
 * protected again, and that repeats until nothing changes, so `download the
 * backup file` stays English end to end. A word the caller asked to convert
 * (`forceConvert`) is never flagged, so it is never reverted.
 */
function guardLoanwords(tokens: Token[]): void {
  const english = (t: Token | undefined) => t?.kind === "protected" && t.reason === "english";
  const neighbour = (i: number, step: 1 | -1): Token | undefined => {
    for (let j = i + step; j >= 0 && j < tokens.length; j += step) {
      if (tokens[j]!.kind !== "space") return tokens[j];
    }
    return undefined;
  };
  for (let changed = true; changed;) {
    changed = false;
    tokens.forEach((token, i) => {
      if (!token.loanword || token.kind !== "word") return;
      if (english(neighbour(i, -1)) || english(neighbour(i, 1))) {
        token.kind = "protected";
        token.reason = "english";
        changed = true;
      }
    });
  }
}

interface ClassifyContext {
  protectSet: ReadonlySet<string>;
  forceSet: ReadonlySet<string>;
  atSentenceStart: boolean;
}

/**
 * Returns a `CopyReason` to protect the word, or `null` to convert it.
 *
 * A loanword-table word (`loan.ts`) is converted even when the English list or
 * `englishness` would protect it: `pizza`, `email` and `instagram` mean پیتزا,
 * ایمیل and اینستاگرام in a Finglish message. `protect` and a mid-sentence
 * capital still win, and `guardLoanwords` puts it back among English words.
 * The detector reads a stretched word without its stretch (`stretch.ts`), so
 * `thanksss` is still English.
 */
function classifyWord(text: string, raw: string, ctx: ClassifyContext): CopyReason | null {
  if (ctx.forceSet.has(raw)) return null;
  if (ctx.protectSet.has(raw)) return "english";
  const lower = unstretch(raw).base;

  // A capitalized token that is not sentence-initial is a proper noun far more
  // often than it is capitalized Finglish. This is what keeps `Muscat` intact
  // in `salam, man emrooz miram Muscat`. Known Finglish words override it,
  // because plenty of people capitalize `Salam`. It also outranks the loanword
  // table: `ba Google meeting daram` capitalized the brand on purpose.
  const isCapitalized = /^[A-Z][a-z]/.test(text);
  if (isCapitalized && !ctx.atSentenceStart && !FINGLISH_HOMOGRAPHS.has(lower)) {
    return "english";
  }
  if (isLoanword(lower)) return null;

  return englishness(lower) >= ENGLISH_THRESHOLD ? "english" : null;
}

/** True when the next word begins a sentence — nothing before it, or terminal punctuation. */
function isAtSentenceStart(tokens: readonly Token[]): boolean {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind === "space") continue;
    return t.kind === "punct" && /[.!?؟۔]\s*$/u.test(t.text);
  }
  return true;
}

function push(tokens: Token[], text: string, kind: TokenKind, start: number, reason?: CopyReason): void {
  tokens.push({ text, kind, start, end: start + text.length, ...(reason ? { reason } : {}) });
}

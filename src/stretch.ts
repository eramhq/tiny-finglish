/**
 * Stretched words — `merciiii`, `areeee`, `hmmm`.
 *
 * Chat stretches a word for emphasis by repeating a letter, and Persian chat
 * does the same thing in Persian script: مرسیییی, آرههههه. Read letter by
 * letter, the stretch is noise the channel has to explain — `merciii` became
 * مرسییی only by luck, `kondeee` did not become کنده at all. So the word is
 * converted without it, and the stretch is put back on the output afterwards.
 *
 * **Collapse.** A run of three or more of one letter is a stretch; a run of two
 * is a real spelling (`aa`, `oo`, `ss` in `kelass`) and is left alone. `a` and
 * `o` collapse to two, because a stretched vowel is a long one (`salaaam` ->
 * `salaam`, `khodaaa` -> `khodaa`); every other letter to one (`merciii` ->
 * `merci`). The collapsed word is the memo key, so a stretch costs no extra
 * conversion.
 *
 * **Re-stretch**, only when the run ends the word and only when the letters
 * agree: a vowel run on a Persian vowel letter (ا ی ه و), a consonant run on
 * a consonant (`hmmm` -> هممم). The last Persian letter then repeats until it
 * matches the typed run, capped at `MAX_STRETCH`. A mismatch — `okkk` ending
 * on the ی of اوکی — just collapses, and so does a stretch in the middle of a
 * word (`salaaaam` -> سلام): where a Persian writer would put the medial
 * stretch is not something the typed letters say.
 *
 * Scoring treats مرسیییی and مرسی as one word (`splitWords` in `metrics.ts`),
 * so keeping the stretch costs nothing against a reference that drops it.
 */

/** A run of three or more of one letter. */
const RUN = /([a-z])\1{2,}/g;

/** Longest re-stretched ending, in Persian letters. */
export const MAX_STRETCH = 6;

const VOWELS = /^[aeiou]$/;
const PERSIAN_VOWEL_LETTERS = /[اآیهو]$/u;

export interface Unstretched {
  /** The word with every stretch collapsed; what gets converted. */
  base: string;
  /** The word-final run, when there is one. */
  final?: { letter: string; length: number };
}

/** Collapse every stretch in a lowercase word. */
export function unstretch(word: string): Unstretched {
  if (!/([a-z])\1\1/.test(word)) return { base: word };
  const base = word.replace(RUN, (run, letter: string) => (letter === "a" || letter === "o" ? letter + letter : letter));
  const tail = /([a-z])\1{2,}$/.exec(word);
  return tail ? { base, final: { letter: tail[1]!, length: tail[0].length } } : { base };
}

/**
 * Put a word-final stretch back on a Persian spelling, or return it unchanged
 * when the typed letter and the written one do not agree.
 */
export function restretch(output: string, final: { letter: string; length: number }): string {
  const last = output.at(-1);
  if (!last || !/\p{Script=Arabic}/u.test(last)) return output;
  if (VOWELS.test(final.letter) !== PERSIAN_VOWEL_LETTERS.test(last)) return output;
  // آ stretches as ا: آاااا, not آآآآ.
  const pad = last === "آ" ? "ا" : last;
  let have = 0;
  for (let i = output.length - 1; i >= 0 && (output[i] === last || output[i] === pad); i--) have++;
  const want = Math.min(final.length, MAX_STRETCH);
  return have >= want ? output : output + pad.repeat(want - have);
}

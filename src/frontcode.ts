/**
 * Front-coded word-list codec.
 *
 * A sorted word list shares long prefixes between neighbours, so storing each
 * entry as "how many bytes I share with my predecessor, then my own suffix"
 * removes most of the redundancy before the compressor ever sees it. Measured
 * on the 100,909-stem Persian lexicon:
 *
 *   plain UTF-8 list           1,758,223 raw -> 220,879 Brotli  (2.19 B/word)
 *   front-coded + 1-byte chars   394,803 raw -> 100,736 Brotli  (1.00 B/word)
 *
 * 2.2x better than a plain list, for about ten lines of decoder. It also beats
 * a serialized DAFSA (146,724 Brotli) — entropy coding wins over structural
 * sharing when the structure is already this regular, so the automaton is worth
 * building at load time but is the wrong thing to put on the wire.
 *
 * Format:
 *   u8    alphabet length N
 *   N x   UTF-16 code unit, little-endian   (the 1-byte alphabet)
 *   u32   word count, little-endian
 *   then per word: u8 shared-prefix length, suffix bytes, 0xFF terminator
 *
 * 0xFF is reserved as the terminator, so the alphabet may hold at most 255
 * distinct characters. Persian uses 45.
 */

const TERMINATOR = 0xff;
const MAX_ALPHABET = 255;

export function encodeFrontCoded(words: readonly string[]): Uint8Array {
  const sorted = [...words].sort();
  const alphabet = [...new Set(sorted.join(""))].sort();
  if (alphabet.length > MAX_ALPHABET) {
    throw new Error(`alphabet of ${alphabet.length} exceeds the ${MAX_ALPHABET}-symbol limit`);
  }
  const code = new Map(alphabet.map((ch, i) => [ch, i]));

  const out: number[] = [alphabet.length];
  for (const ch of alphabet) {
    const unit = ch.charCodeAt(0);
    out.push(unit & 0xff, (unit >> 8) & 0xff);
  }
  const count = sorted.length;
  out.push(count & 0xff, (count >> 8) & 0xff, (count >> 16) & 0xff, (count >> 24) & 0xff);

  let previous = "";
  for (const word of sorted) {
    let shared = 0;
    const max = Math.min(word.length, previous.length, 255);
    while (shared < max && word[shared] === previous[shared]) shared++;
    out.push(shared);
    for (let i = shared; i < word.length; i++) {
      const byte = code.get(word[i]!);
      if (byte === undefined) throw new Error(`character ${JSON.stringify(word[i])} not in alphabet`);
      out.push(byte);
    }
    out.push(TERMINATOR);
    previous = word;
  }
  return Uint8Array.from(out);
}

export function decodeFrontCoded(bytes: Uint8Array): string[] {
  return decodeFrontCodedAt(bytes, 0).words;
}

/**
 * Decode starting at `offset`, also returning where the word list ended.
 *
 * The frequency artifact appends a parallel byte array after the words, so its
 * reader needs to know where they stop.
 */
export function decodeFrontCodedAt(
  bytes: Uint8Array,
  start: number,
): { words: string[]; offset: number } {
  let offset = start;
  const alphabetLength = bytes[offset++]!;
  const alphabet: string[] = [];
  for (let i = 0; i < alphabetLength; i++) {
    alphabet.push(String.fromCharCode(bytes[offset]! | (bytes[offset + 1]! << 8)));
    offset += 2;
  }
  const count =
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24);
  offset += 4;

  const words = new Array<string>(count);
  let previous = "";
  for (let i = 0; i < count; i++) {
    const shared = bytes[offset++]!;
    let suffix = "";
    while (bytes[offset] !== TERMINATOR) suffix += alphabet[bytes[offset++]!];
    offset++;
    previous = previous.slice(0, shared) + suffix;
    words[i] = previous;
  }
  return { words, offset };
}

"""Synthetic Finglish generator — Persian script to plausible Finglish.

This is the training-data engine and, per the plan, the most important artifact
of M1. It walks a Persian word and emits **aligned** (persian, latin) chunk
pairs, which ``labels.py`` turns directly into per-character training targets.
Because the generator produces the alignment, the transducer never needs a
separate aligner.

--------------------------------------------------------------------------
KNOWN WEAKNESS — read before trusting any number produced from this corpus.
--------------------------------------------------------------------------
Persian is an abjad: short vowels are not written. Going Persian -> Finglish
therefore requires knowing the pronunciation, and we have no redistributable
Persian pronunciation dictionary (the obvious one, Tihu, is GPL and would
contaminate an MIT package). So short vowels here are *inferred* from syllable
structure and then *sampled* from a frequency prior — `ketab` and `kotab` are
both reachable from کتاب, and only one is right.

Consequences, stated plainly:
  * Consonants, long vowels and the ا/آ/و/ی skeleton are faithful. The
    long-vs-short distinction that actually carries the ambiguity — دار `daar`
    versus در `dar` — is preserved structurally and is not affected.
  * Short-vowel *quality* (a/e/o) is noise. A model trained here learns to be
    largely short-vowel-insensitive, which happens to match how inconsistently
    real users type, but it is luck rather than design.
  * Accuracy measured on this corpus is optimistic. Published work that
    evaluated a comparable rule system on machine-generated romanization
    measured ~81-83% top-1 and explicitly flagged it as a ceiling, not a field
    expectation. The untouched human-written gold set in ``data/gold/`` exists
    precisely because this number cannot be trusted.

Fixing this properly means acquiring a permissively licensed pronunciation
lexicon or real Finglish/Persian pairs. See ``docs/open-items.md``.
"""

from __future__ import annotations

import random
import unicodedata
from dataclasses import dataclass

from .normalize import ZWNJ, normalize
from .pronunciation import load as load_pronunciation, short_vowels
from .rules import spellings_by_role

CONSONANTS = set("بپتثجچحخدذرزژسشصضطظعغفقکگلمنهی")
# و and ی are consonants or vowels depending on context; resolved in _classify().
AMBIGUOUS = set("وی")
LONG_VOWELS = set("اآ")

#: Sonority classes, used to reject impossible coda clusters. Persian tolerates
#: rising-sonority codas in Arabic loans (سبز `sabz`, صبح `sobh`), so full
#: sonority sequencing is too strict. What it does *not* tolerate is a coda of
#: two sonorants at equal or rising sonority — which is why دانم must be
#: `danam` and cannot be `danm`.
NASALS = set("من")
LIQUIDS = set("رل")

#: و and ی are absent from CONSONANTS because their own role is contextual, but
#: when judging a *neighbour* they count as consonants: the ی of دویدن is a
#: vowel precisely because a consonantal و precedes it.
CONSONANT_LIKE = CONSONANTS | AMBIGUOUS

#: Prior over unwritten short vowels. Roughly reflects Persian frequency, but
#: it is a guess in the absence of a pronunciation dictionary — see module docs.
SHORT_VOWEL_PRIOR = (("a", 0.45), ("e", 0.35), ("o", 0.20))

#: How often the generator picks a non-canonical spelling of a grapheme, e.g.
#: `x` for خ instead of `kh`. Real Finglish is wildly inconsistent, and the
#: Roman-Urdu literature finds that modelling romanized-side spelling variation
#: is exactly what makes these systems robust.
VARIANT_RATE = 0.30

#: How often a known short vowel is used verbatim when the dictionary is
#: enabled at all. See USE_PRONUNCIATION below for why it is not, by default.
PRONUNCIATION_RATE = 0.75

#: Whether to use the real pronunciation dictionary. **Off, and that is a
#: measured decision, not an oversight.**
#:
#: Persian does not write short vowels, so this generator infers where one
#: belongs and samples which one. That is the weakness this module's docstring
#: has always flagged, and `data/lexicon/fa-pronunciation.bin` (CC0) fixes it
#: in principle: کتاب really is `ketab`, بزرگ really is `bozorg`.
#:
#: Using it makes the model worse. Ablated at three rates, same 102k model,
#: same recipe, word accuracy:
#:
#:     pronunciation    fixtures    real Finglish
#:       0% (sampled)      74.8%           44.6%
#:      75% (blended)      69.6%           41.2%
#:     100% (verbatim)     65.2%           37.7%
#:
#: Monotonic in the wrong direction, on both evaluation sets. The mechanism is
#: diversity: fixing the vowel to the correct one cut distinct spellings per
#: word from 4.72 to 4.09. A model that only ever sees `ketaab` never learns
#: that `ketab` and `ketob` are also کتاب — and real people type all three.
#:
#: So for this task, *correct* training data is worse than *varied* training
#: data. The dictionary stays in the repository because the finding is worth
#: keeping and because its value should rise if coverage improves past today's
#: 23.9% of the lexicon — but it is off, and turning it on needs a new
#: measurement, not an assumption.
USE_PRONUNCIATION = False

#: How often a vowel is written as a diphthong (`ow` for و, `ey` for ی).
#: Measured as low single digits in real Finglish, not the ~15% the old
#: variant_rate/2 heuristic produced.
DIPHTHONG_RATE = 0.02


@dataclass(frozen=True)
class Chunk:
    """One aligned correspondence. Either side may be empty, never both."""

    fa: str
    latin: str


class FinglishGenerator:
    def __init__(
        self,
        seed: int | None = None,
        variant_rate: float = VARIANT_RATE,
        use_pronunciation: bool = USE_PRONUNCIATION,
        pronunciation_rate: float = PRONUNCIATION_RATE,
    ):
        self.rng = random.Random(seed)
        self.variant_rate = variant_rate
        self.pronunciation_rate = pronunciation_rate
        #: Persian word -> phoneme. Supplies the short vowels the script omits.
        #: Empty when the artifact is absent, in which case they are sampled.
        self.pronunciation = load_pronunciation() if use_pronunciation else {}
        self._vowels: list[str] = []

    # -- public ------------------------------------------------------------

    def generate(self, word: str) -> list[Chunk]:
        """Return aligned chunks for one normalized Persian word."""
        word = normalize(word)
        if not word:
            return []
        # Queue this word's real short vowels, if we know them. `_short_vowel`
        # pops from the queue and only samples once it is empty — so کتاب comes
        # out `ketab`, not the coin-flip between `ketab` and `kotab` that this
        # generator produced before the dictionary existed.
        self._vowels = short_vowels(self.pronunciation.get(word, ""))
        chunks: list[Chunk] = []
        for run in _split_runs(word):
            chunks.extend(self._emit_run(run))
        return chunks

    def romanize(self, word: str) -> str:
        return "".join(c.latin for c in self.generate(word))

    def generate_sentence(self, sentence: str) -> tuple[str, list[list[Chunk]]]:
        """Romanize a whole Persian sentence, preserving spacing and punctuation."""
        out: list[str] = []
        per_word: list[list[Chunk]] = []
        for token in _tokenize_persian(sentence):
            if token.strip() and any(ch in CONSONANTS or ch in LONG_VOWELS or ch in AMBIGUOUS for ch in token):
                chunks = self.generate(token)
                per_word.append(chunks)
                out.append("".join(c.latin for c in chunks))
            else:
                out.append(token)
        return "".join(out), per_word

    # -- internals ---------------------------------------------------------

    def _spell(self, fa: str, role: str) -> str:
        """Pick a Finglish spelling for one Persian grapheme in a known role.

        Where the rule table carries measured weights, sample from them
        directly — they already encode how often each spelling really occurs.
        Where it does not, fall back to the old behaviour: emit the canonical
        form, and with probability `variant_rate` swap in a uniform alternative.
        """
        entry = spellings_by_role().get((fa, role)) or spellings_by_role().get((fa, "consonant"))
        if not entry:
            return fa
        options, weights = entry
        if len(options) == 1:
            return options[0]
        if weights:
            return self.rng.choices(options, weights=weights)[0]
        if self.rng.random() < self.variant_rate:
            return self.rng.choice(options[1:])
        return options[0]

    def _short_vowel(self) -> str:
        # Real pronunciation first, in order — but only `pronunciation_rate` of
        # the time. The queue is consumed either way so later slots stay
        # aligned with the word. A word can also need more vowel slots than the
        # phoneme string supplies (ezafe, clitics), so the fallback stays live
        # rather than being an error path.
        if self._vowels:
            known = self._vowels.pop(0)
            if self.rng.random() < self.pronunciation_rate:
                return known
        r = self.rng.random()
        cumulative = 0.0
        for vowel, p in SHORT_VOWEL_PRIOR:
            cumulative += p
            if r < cumulative:
                return vowel
        return "a"

    def _emit_run(self, run: "Run") -> list[Chunk]:
        if run.kind == "vowel":
            return [Chunk(run.text, self._spell_vowel(run))]
        if run.kind == "other":
            return [Chunk(run.text, run.text)]
        if run.kind == "zwnj":
            # ZWNJ is an ordinary output label. Users type it as nothing, a
            # space or a hyphen; all three must map back to U+200C.
            return [Chunk(ZWNJ, self.rng.choices(["", " ", "-"], weights=[0.75, 0.15, 0.10])[0])]
        if run.kind == "silent-vav":
            # The silent و of خوا: خواب `khab`, خواهر `khahar`, خواستن `khastan`.
            return [Chunk("و", "")]
        return self._emit_consonants(run)

    def _spell_vowel(self, run: "Run") -> str:
        ch = run.text
        if ch == "آ":
            return self._spell("آ", "vowel")
        if ch == "ا":
            # Word-initial alef is a carrier for a short vowel; elsewhere it is
            # long ɒː. Getting this wrong is the difference between `emrooz`
            # and `aamrooz`.
            if run.position == "initial":
                return self._short_vowel()
            return self._spell("ا", "vowel")
        if run.silent_he:
            return self._spell("ه", "silent")
        if len(ch) == 2:
            return self._spell(ch, "vowel")
        # Genuine diphthong spellings (`ow`, `ey`) are rare in real typing —
        # `khowb` for خوب is attested but uncommon, and at the old rate of
        # variant_rate/2 the generator produced it about one time in eight.
        if self.rng.random() < DIPHTHONG_RATE:
            return self._spell(ch, "diphthong")
        return self._spell(ch, "vowel")

    def _emit_consonants(self, run: "Run") -> list[Chunk]:
        """Syllabify a consonant run, inserting the short vowels Persian omits.

        Persian syllables are (C)V(C)(C) with no onset clusters, so every
        consonant that opens a syllable must be followed by a nucleus. Where the
        next written character supplies one we use it; otherwise we insert an
        unwritten short vowel, which becomes an empty-Persian chunk.

        Assignment follows the maximal onset principle: a consonant becomes a
        coda only when it has to. That is what makes بزرگ come out `bozorg`
        (bo-zorg) rather than `bazrag`.
        """
        chunks: list[Chunk] = []
        letters = run.text
        n = len(letters)

        # When a written vowel follows the run, its syllable needs an onset, and
        # the last consonant of the run is it. Reserve it.
        reserved = 1 if run.followed_by_vowel else 0
        limit = n - reserved

        i = 0
        syllable_open = run.preceded_by_nucleus
        while i < limit:
            if not syllable_open:
                chunks.append(Chunk(letters[i], self._spell(letters[i], "consonant")))
                chunks.append(Chunk("", self._short_vowel()))
                syllable_open = True
                i += 1
                continue

            rest = letters[i:limit]
            # An exhausted vowel queue is evidence, not an edge case: if we know
            # this word's pronunciation and it has no vowels left, the remaining
            # consonants really are a coda. That is what makes صبر come out
            # `sabr` rather than `sabar` even though بر is not in the attested
            # cluster list.
            pronunciation_says_coda = bool(self.pronunciation) and not self._vowels
            if len(rest) <= 2 and (_is_legal_coda(rest) or pronunciation_says_coda):
                for ch in rest:
                    chunks.append(Chunk(ch, self._spell(ch, "consonant")))
                i = limit
            elif _is_legal_coda(rest[1:]):
                # Maximal onset: give this consonant to the next syllable and
                # let the remainder close it. بزرگ -> bo-zorg.
                syllable_open = False
            else:
                # The remainder cannot close a syllable on its own, so this
                # consonant is forced to be a coda here. مسقط -> mas-ghat,
                # not me-se-ghet.
                chunks.append(Chunk(letters[i], self._spell(letters[i], "consonant")))
                i += 1

        if reserved:
            ch = letters[limit]
            chunks.append(Chunk(ch, self._spell(ch, "consonant")))

        return chunks


#: Persian coda clusters that actually occur. Closed enough to enumerate, and
#: an explicit list beats a sonority theory here: sonority sequencing calls
#: سبز `sabz` and صبح `sobh` illegal (they are fine) while admitting `nsh`
#: (which never occurs — دانش is `danesh`, not `dansh`). Anything not listed
#: gets a short vowel inserted, which is the safe direction to err.
ATTESTED_CODAS = frozenset(
    """
    ست شت خت فت پت کت
    رد رگ رز رس رف رم رن رخ رچ رج رک رب رو رت رش رع رض رط
    ند نگ نج نز نس نت نک نچ نف نب
    لد لم لف لگ لس لت لخ لب لچ لج لع
    سب بز بح صح زد ژد مب مد مس سک سپ کس خش فس نظ حم عل عم عب عت عد عش عض عف عق
    """.split()
)


def _is_legal_coda(cluster: str) -> bool:
    """Can `cluster` close a Persian syllable without an intervening vowel?

    One consonant always can; two only if attested. This is what forces دانم
    to be `danam` rather than `danm`, and دانش to be `danesh` rather than
    `dansh`, while leaving دست `dast` and جنگ `jang` alone.
    """
    if len(cluster) <= 1:
        return True
    if len(cluster) > 2:
        return False
    return cluster in ATTESTED_CODAS


@dataclass
class Run:
    text: str
    kind: str  # consonant | vowel | zwnj | silent-vav | other
    position: str  # initial | medial | final
    preceded_by_nucleus: bool
    followed_by_vowel: bool
    silent_he: bool = False


def _classify(ch: str, prev: str, nxt: str) -> str:
    """Decide what job one Persian character is doing in this context."""
    if ch == ZWNJ:
        return "zwnj"
    if ch in LONG_VOWELS:
        return "vowel"
    if ch == "و":
        # The silent و of خوا: خواب `khab`, خواهر `khahar`, خواستن `khastan`.
        if prev == "خ" and nxt in LONG_VOWELS:
            return "silent-vav"
        # و is a vowel when a consonant precedes it and no vowel follows that
        # would make it an onset: خوب `khoob` vowel, دویدن `davidan` consonant.
        if nxt == "ی":
            return "consonant"
        if prev in CONSONANT_LIKE and nxt not in LONG_VOWELS:
            return "vowel"
        return "consonant"
    if ch == "ی":
        # ی is a vowel after a consonant, a consonant before a vowel or at the
        # start: میروم `miram` vowel, یک `yek` consonant.
        if prev in CONSONANT_LIKE and nxt not in LONG_VOWELS:
            return "vowel"
        return "consonant"
    if ch in CONSONANTS:
        return "consonant"
    return "other"


def _split_runs(word: str) -> list[Run]:
    """Segment a Persian word into runs the emitter can handle independently."""
    kinds = []
    for i, ch in enumerate(word):
        prev = word[i - 1] if i else ""
        nxt = word[i + 1] if i + 1 < len(word) else ""
        kinds.append(_classify(ch, prev, nxt))

    # Word-final ه preceded by a consonant is the silent he — خانه `khune`,
    # نامه `name`. After a vowel it is a real /h/ — دانشگاه `daneshgah`.
    silent_he_at = -1
    if len(word) > 1 and word[-1] == "ه" and kinds[-1] == "consonant" and kinds[-2] == "consonant":
        silent_he_at = len(word) - 1
        kinds[-1] = "silent-he"

    runs: list[Run] = []
    i = 0

    # Word-initial ای and او are single long vowels, not alef-carrier plus
    # consonant: ایران is `iran`, not `ayran`; اوستا is `avesta`... which is
    # genuinely `avesta`, so this only fires when a consonant follows, keeping
    # این `in` and اوج `oj` right and accepting اول `avval` as a known miss.
    if len(word) >= 3 and word[0] == "ا" and word[1] in AMBIGUOUS and kinds[2] == "consonant":
        digraph = word[:2]
        runs.append(Run(digraph, "vowel", "initial", False, False))
        i = 2

    while i < len(word):
        kind = kinds[i]
        if kind == "consonant":
            j = i
            while j < len(word) and kinds[j] == "consonant":
                j += 1
        else:
            j = i + 1

        text = word[i:j]
        position = "initial" if i == 0 else ("final" if j == len(word) else "medial")
        preceded = bool(runs) and runs[-1].kind in ("vowel", "silent-vav")
        # A silent و still bars a short vowel from being inserted before it:
        # خواب is `khab`, never `khaab` with an epenthetic vowel after خ.
        followed = j < len(word) and kinds[j] in ("vowel", "silent-vav", "silent-he")

        if kind == "silent-he":
            runs.append(Run(text, "vowel", position, True, False, silent_he=True))
        else:
            runs.append(Run(text, kind, position, preceded, followed))
        i = j

    _ = silent_he_at
    return runs


def _tokenize_persian(text: str) -> list[str]:
    """Split into word and non-word tokens, preserving everything."""
    tokens: list[str] = []
    buf = ""
    buf_is_word = False
    for ch in text:
        is_word = ch == ZWNJ or unicodedata.category(ch).startswith("L")
        if buf and is_word != buf_is_word:
            tokens.append(buf)
            buf = ""
        buf += ch
        buf_is_word = is_word
    if buf:
        tokens.append(buf)
    return tokens

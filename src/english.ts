/**
 * English-token detection data.
 *
 * Precision matters far more than recall here. Converting a brand name into
 * Persian gibberish is the fastest way to lose a user (`PLAN.md`'s risk
 * register puts "English preservation" third); failing to convert an English
 * word merely leaves it as the user typed it, which is usually fine.
 *
 * So these lists are deliberately small and curated rather than large and
 * general. A big English dictionary is actively harmful here, because Finglish
 * collides with English constantly — see `FINGLISH_HOMOGRAPHS`.
 */

/**
 * Common English words that are NOT plausible Finglish. Membership is a strong
 * copy signal. Kept short on purpose; every entry was checked against the
 * Finglish reading.
 *
 * **Loanwords that convert correctly are not here.** Measured on the dev set,
 * a Finglish typist writing `hotel`, `asia` or `and` means هتل, آسیا, اند — the
 * reference writes them in Persian — and protecting them was a word error
 * every time. Removed: every entry whose forced conversion is the right Persian
 * spelling of a common loanword or place name (hotel, doctor, address, battery,
 * filter, server, asia, america, canada, japan, tokyo, london, paris, berlin),
 * and `and`, which is the Finglish اند. Kept: brand names, even where they
 * would convert correctly (گوگل), because preserving a brand the user typed
 * matters more than the average; and loanwords the rules would misspell
 * (`download` would become دونلد, `email` امیل), because a protected English
 * word beats a wrong Persian one.
 */
export const ENGLISH_WORDS: ReadonlySet<string> = new Set(
  `the for are but not you all any can had her was one our out day get has him his how its may new now old see two who boy did she use way she
   about after again below could every first found great house large learn never other place right small sound still such their there these thing think three under water where which world would write years young
   because before between both during through while against always another around behind during either enough however maybe might must myself nothing perhaps really should something sometimes though together whether without
   please thanks thank sorry hello goodbye yes okay
   email inbox password username login logout signup signin account settings profile search upload download delete update install uninstall
   file folder client browser network database query cache token session cookie
   google apple microsoft amazon netflix spotify youtube twitter facebook instagram telegram whatsapp linkedin github gitlab discord reddit tiktok
   iphone android windows linux macos ubuntu chrome firefox safari edge
   react vue angular svelte node deno typescript javascript python rust golang swift kotlin java
   startup meeting deadline project manager engineer designer developer product feature release version build deploy
   monday tuesday wednesday thursday friday saturday sunday
   january february march april june july august september october november december
   airport flight ticket booking restaurant coffee pizza burger
   madrid rome sydney toronto dubai doha muscat kuwait riyadh istanbul moscow beijing
   england france germany spain italy australia europe africa
   university college school student teacher professor library hospital patient
   money price discount payment invoice receipt shipping delivery
   music video photo camera screen keyboard mouse phone laptop tablet charger`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Tokens that look English but are far more likely to be Finglish. These
 * override `ENGLISH_WORDS` and the capitalization heuristic.
 *
 * This list is the whole reason the English detector cannot just be a big
 * dictionary lookup. `man` is من, `in` is این, `to` is تو, `bad` is بد,
 * `sad` is صد, `dust` is دوست, `name` is نامه, `chap` is چپ.
 */
export const FINGLISH_HOMOGRAPHS: ReadonlySet<string> = new Set(
  `man to in az ba be bar bad bood bud sad sar shod shab shom chap chera chi che chand and
   dar dard dast dust doost darad daram dare del dige digar
   goft gol gom gah haft hal ham hame har hast hich
   in un on az ke ki key kar kam kard konam koja
   mah man mard mara mese mikonam miram mishe nan nane nist no nou nam name
   pas par por pol pir ran rah raft ro roo roz sang sib sobh
   tan tar tor tou tu ta tak tang toop
   yek yad zan zir zood
   ast are ara ali amir arash reza sara sina mina nima mani rami
   tehran esfahan isfahan shiraz mashhad tabriz ahvaz karaj qom rasht yazd kerman urmia zahedan
   iran irani tehrani farsi persia alborz damavand zagros caspian
   hafez saadi ferdowsi rumi molana khayyam sohrab forough`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Orthographic features that occur in English but essentially never in
 * Finglish, which spells phonetically. Each contributes to a score so that no
 * single weak signal can protect a token on its own.
 */
const ENGLISH_SUFFIXES = ["tion", "sion", "ment", "ness", "ship", "able", "ible", "ing", "ely", "ity", "ous", "ful", "ize", "ise"];
const ENGLISH_CLUSTERS = ["th", "wh", "ck", "ph", "qu", "wr", "kn", "gh_silent", "oa", "ea", "ue", "ay", "ow"];
const DOUBLE_LETTERS = /(.)\1/;

/**
 * Score in roughly [0, 1] that `token` (already lowercased, letters only) is
 * English rather than Finglish. Callers apply the threshold.
 */
export function englishness(token: string): number {
  if (token.length < 2) return 0;
  if (FINGLISH_HOMOGRAPHS.has(token)) return 0;
  if (ENGLISH_WORDS.has(token)) return 1;

  let score = 0;
  for (const suffix of ENGLISH_SUFFIXES) {
    // `ize`/`ise` need a real stem in front: `chize` چیزه, `kise` کیسه and
    // `reise` رئیسه are everyday Finglish, while the English words are long —
    // `realize`, `promise`, `advise`.
    const minLength = suffix === "ize" || suffix === "ise" ? 6 : suffix.length + 2;
    if (token.length >= minLength && token.endsWith(suffix)) {
      score += 0.45;
      break;
    }
  }
  // `wh` on its own is decisive: Finglish has no /w/ digraph at all, so any
  // token containing it is English. `th` is strong but not decisive — a `t`+`h`
  // sequence can arise across a Persian morpheme boundary — so it needs a
  // second signal to cross the threshold.
  if (token.includes("wh")) score += 0.5;
  if (token.includes("th")) score += 0.35;
  for (const cluster of ENGLISH_CLUSTERS) {
    if (cluster !== "gh_silent" && token.includes(cluster)) score += 0.08;
  }
  // Doubled consonants are an English spelling convention; Finglish writes the
  // sound once. `ss` in `messi` is the exception that proves it — a loanword.
  if (DOUBLE_LETTERS.test(token) && !/(aa|ee|oo|ii|uu)/.test(token)) score += 0.2;
  // Silent final `e` after a consonant.
  if (/[bcdfgklmnprstvz]e$/.test(token) && token.length > 3) score += 0.15;

  return Math.min(score, 0.99);
}

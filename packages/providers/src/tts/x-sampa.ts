/**
 * IPA to X-SAMPA, because Cloud Text-to-Speech will not take IPA.
 *
 * Discovered against a live key on 2026-08-13: every `PHONETIC_ENCODING_IPA`
 * pronunciation was rejected with "the following custom pronunciation phrases
 * are invalid", on every voice family, for every phrase, whatever symbols it
 * contained — while the identical pronunciation as `PHONETIC_ENCODING_X_SAMPA`
 * was accepted. Whether that is an account-level restriction or the API's
 * general behaviour does not much matter: IPA does not work here and X-SAMPA
 * does.
 *
 * The hints themselves stay IPA. That is what a human finds when they look up
 * how a name is said, it is what Wiktionary prints, and it is what the
 * ElevenLabs `<phoneme>` tag takes — so the settings field keeps the notation
 * people can actually source, and the conversion happens at the one adapter
 * that needs it.
 *
 * X-SAMPA is a stable published ASCII transliteration of IPA, so unlike a model
 * id this is a mapping that can be written down once and stay true. The
 * conversion is verified end to end against the live API by a probe, not merely
 * asserted here.
 */

/**
 * Longest-match-first, because several IPA symbols are multi-codepoint and
 * some X-SAMPA forms are multi-character. Order matters: `ɑː` must be tried
 * before `ɑ`, or the length mark is orphaned.
 */
const MAP: readonly (readonly [string, string])[] = [
  // Stress and length
  ['ˈ', '"'],
  ['ˌ', '%'],
  ['ː', ':'],
  ['ˑ', ':\\'],
  // Vowels
  ['ə', '@'],
  ['ɚ', '@`'],
  ['ɜ', '3'],
  ['ɝ', '3`'],
  ['ɐ', '6'],
  ['ɪ', 'I'],
  ['ʊ', 'U'],
  ['ɛ', 'E'],
  ['æ', '{'],
  ['ɑ', 'A'],
  ['ɒ', 'Q'],
  ['ɔ', 'O'],
  ['ʌ', 'V'],
  ['ø', '2'],
  ['œ', '9'],
  ['ɤ', '7'],
  ['ɯ', 'M'],
  ['ɨ', '1'],
  ['ʉ', '}'],
  ['y', 'y'],
  // Consonants
  ['ʃ', 'S'],
  ['ʒ', 'Z'],
  ['θ', 'T'],
  ['ð', 'D'],
  ['ŋ', 'N'],
  ['ɲ', 'J'],
  ['ɳ', 'n`'],
  ['ʔ', '?'],
  ['ɡ', 'g'],
  ['ɣ', 'G'],
  ['χ', 'X'],
  ['ʁ', 'R'],
  ['ɹ', 'r\\'],
  ['ɾ', '4'],
  ['ʋ', 'v\\'],
  ['ɫ', '5'],
  ['ʎ', 'L'],
  ['ç', 'C'],
  ['β', 'B'],
  ['ɸ', 'p\\'],
  ['ʍ', 'W'],
  ['ʈ', 't`'],
  ['ɖ', 'd`'],
  ['ʂ', 's`'],
  ['ʐ', 'z`'],
  // Diacritics that carry no X-SAMPA weight for our purposes
  ['ˡ', ''],
  ['ʰ', '_h'],
  ['̃', '~'],
  // Tie bars and separators that would otherwise survive into the output
  ['͡', ''],
  ['͜', ''],
  ['.', '.'],
]

/** Characters X-SAMPA leaves alone: plain ASCII letters and its own symbols. */
const PASSTHROUGH = /^[a-zA-Z0-9"%:@{}()[\]\\`~?!^_=+<>&*#$.\-|]$/

/**
 * Convert an IPA transcription to X-SAMPA.
 *
 * Slashes and square brackets around the transcription are stripped, because
 * `/ˈvaɪɐkart/` is how a human writes one and neither delimiter is part of the
 * phonemes.
 *
 * Anything not in the table and not already valid X-SAMPA is **dropped**, and
 * the caller is told nothing about it — deliberately, because the adapter
 * verifies the result with the vendor anyway and a hint the vendor rejects is
 * dropped there with a visible flag. Guessing at an unknown symbol would be
 * worse than omitting it.
 */
export function ipaToXSampa(ipa: string): string {
  const stripped = ipa.trim().replace(/^[/[]|[/\]]$/g, '')

  let out = ''
  let index = 0

  outer: while (index < stripped.length) {
    for (const [from, to] of MAP) {
      if (stripped.startsWith(from, index)) {
        out += to
        index += from.length
        continue outer
      }
    }

    const char = stripped[index] ?? ''
    if (PASSTHROUGH.test(char)) out += char
    index += 1
  }

  return out
}

/** Whether a converted transcription has anything left to say. */
export function isUsableXSampa(value: string): boolean {
  return /[a-zA-Z0-9{}@]/.test(value)
}

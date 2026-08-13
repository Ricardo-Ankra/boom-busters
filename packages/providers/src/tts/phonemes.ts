import type { PhonemeHint } from '@boom-busters/schemas'

/**
 * Making a narrator say "Wirecard" the way a German says it (spec section 6).
 *
 * The hint list is channel-wide and can hold two hundred entries, while a
 * paragraph mentions three of them. So the first job here is **selection**:
 * sending the whole dictionary with every paragraph would put the entire list
 * into a prompt that is paid for per character, on every one of sixty
 * paragraphs, to correct terms that are not in the text.
 *
 * The second job is that the two vendors take direction differently, and
 * neither takes it the way the other does:
 *
 *  - **Gemini TTS is prompt-steered.** There is no markup; the style prompt is
 *    natural language, so the hints become instructions in it.
 *  - **ElevenLabs takes inline SSML-ish markup**, but its `<phoneme>` tag only
 *    accepts a real phonetic alphabet. A hint written as an IPA string becomes
 *    a tag; a hint written as a plain respelling ("VEER-card") is not IPA and
 *    cannot be one, so it is substituted into the text instead — which is what
 *    a respelling is for.
 *
 * Both are pure string functions, which is the point: pronunciation is exactly
 * the kind of thing that is expensive to get wrong and impossible to check by
 * listening to a mock, so it is checked by reading the request instead.
 */

/** IPA is conventionally written between slashes; anything else is a respelling. */
export function isIpa(hint: string): boolean {
  return /^\/.+\/$/.test(hint.trim())
}

/** `/ˈkæt/` → `ˈkæt`. The slashes are how a human writes a transcription, not
 *  part of it, and no vendor's phonetic field wants them. */
export function stripSlashes(hint: string): string {
  return hint.trim().replace(/^\/|\/$/g, '')
}

/** Escape a term for use inside a `RegExp`. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A whole-word, case-insensitive matcher for a term.
 *
 * `\b` is wrong at the edges for terms that start or end in punctuation —
 * "S&P 500" and "Sarbanes-Oxley" are both real hint terms in this subject
 * matter — so the boundaries are asserted against letters and digits directly.
 */
function matcher(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term.trim())}(?![\\p{L}\\p{N}])`, 'giu')
}

/** Only the hints whose term actually appears in this paragraph. */
export function matchedHints(text: string, hints: readonly PhonemeHint[]): readonly PhonemeHint[] {
  return hints.filter((hint) => matcher(hint.term).test(text))
}

/**
 * The hints as instructions appended to a style prompt, for Gemini.
 *
 * Returns the prompt unchanged when nothing matches, rather than appending an
 * empty "Pronounce the following:" heading that would spend tokens saying
 * nothing and give the model a list to hallucinate entries into.
 */
export function stylePromptWithHints(
  stylePrompt: string,
  text: string,
  hints: readonly PhonemeHint[],
): string {
  const matched = matchedHints(text, hints)
  if (matched.length === 0) return stylePrompt

  const lines = matched.map((hint) =>
    isIpa(hint.hint)
      ? `- "${hint.term}" is pronounced ${stripSlashes(hint.hint)} (IPA)`
      : `- "${hint.term}" is pronounced "${hint.hint}"`,
  )

  return [
    stylePrompt.trim(),
    'Pronounce these terms exactly as given, and do not read the guidance aloud:',
    ...lines,
  ]
    .filter((part) => part.length > 0)
    .join('\n')
}

/**
 * The text with pronunciation applied inline, for ElevenLabs.
 *
 * IPA hints become `<phoneme>` tags around the original word, so what is spoken
 * still corresponds to what is written. Respellings replace the word, because
 * that is the only way to convey them — noted in the return value's shape by
 * nothing at all, deliberately: the script in the database is untouched either
 * way, and this string exists only for the duration of one HTTP request.
 */
export function markUpPhonemes(text: string, hints: readonly PhonemeHint[]): string {
  let marked = text

  for (const hint of matchedHints(text, hints)) {
    marked = marked.replace(matcher(hint.term), (match) =>
      isIpa(hint.hint)
        ? `<phoneme alphabet="ipa" ph="${stripSlashes(hint.hint)}">${match}</phoneme>`
        : hint.hint,
    )
  }

  return marked
}

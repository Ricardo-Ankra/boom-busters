import { matchedHints } from '@boom-busters/schemas'
import type { PhonemeHint } from '@boom-busters/schemas'

/**
 * Making the narrator say "Wirecard" the way a German says it (spec section 6).
 *
 * The hint list is channel-wide and can hold two hundred entries, while a
 * paragraph mentions three of them. So the first job here is **selection**:
 * sending the whole dictionary with every paragraph would put the entire list
 * into a request that is paid for per character, on every one of sixty
 * paragraphs, to correct terms that are not in the text.
 *
 * The second job is fitting the hints to what Eleven v3 actually takes, which
 * is less than the old vendors pretended to: there is no phoneme markup on
 * v3 — no SSML, no `<phoneme>` tag — so a **respelling** ("VEER-card") is
 * substituted straight into the text, and an **IPA transcription** has no way
 * in at all. IPA hints are dropped and *reported*, because spec principle 6
 * allows degrading and forbids doing it quietly; the settings screen tells
 * you to write respellings for the same reason.
 *
 * (The dictionary endpoint ElevenLabs does offer is account-level state that
 * has to be created, versioned and referenced by id — three round trips to
 * say what a substitution says in none, at the cost of not being a pure
 * string function this package can test. Same deliberate deviation as before;
 * revisit if the hint list ever grows large enough to matter per request.)
 */

/** IPA is conventionally written between slashes; anything else is a respelling. */
export function isIpa(hint: string): boolean {
  return /^\/.+\/$/.test(hint.trim())
}

/** `/ˈkæt/` → `ˈkæt`. The slashes are how a human writes a transcription, not
 *  part of it. */
export function stripSlashes(hint: string): string {
  return hint.trim().replace(/^\/|\/$/g, '')
}

/**
 * Which hints apply to a paragraph lives in `schemas`, and is re-exported
 * rather than reimplemented: `takeIdempotencyKey` folds the applicable hints
 * into a take's identity, so the answer it gets and the answer the adapter
 * gets have to be the same one. Two copies of this regex would eventually mean
 * a key claiming a set of pronunciations the request never carried.
 */
export { matchedHints }

/**
 * The same whole-word rule, for substituting rather than selecting.
 *
 * `\b` is wrong at the edges for terms that start or end in punctuation —
 * "S&P 500" and "Sarbanes-Oxley" are both real hint terms in this subject
 * matter — so the boundaries are asserted against letters and digits directly.
 */
function matcher(term: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
    'giu',
  )
}

/**
 * The text with every applicable respelling substituted in, and the IPA hints
 * that could not be conveyed listed by term.
 *
 * The script in the database is untouched either way; the substituted string
 * exists only for the duration of one HTTP request. Pure, which is the point:
 * pronunciation is exactly the kind of thing that is expensive to get wrong
 * and impossible to check by listening to a mock, so it is checked by reading
 * the request instead.
 */
export function applyPronunciations(
  text: string,
  hints: readonly PhonemeHint[],
): { text: string; dropped: string[] } {
  let spoken = text
  const dropped: string[] = []

  for (const hint of matchedHints(text, hints)) {
    if (isIpa(hint.hint)) {
      dropped.push(hint.term)
      continue
    }
    spoken = spoken.replace(matcher(hint.term), hint.hint)
  }

  return { text: spoken, dropped }
}

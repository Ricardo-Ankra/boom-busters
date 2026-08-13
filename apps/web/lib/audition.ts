import { createHash } from 'node:crypto'
import type { TtsProvider } from '@boom-busters/schemas'

/**
 * The audition panel's limits, and the shape of its answer.
 *
 * In their own module because a `'use server'` file may only export async
 * functions — a constant exported from one is a build error, not a lint
 * warning. The panel and the action both need these numbers, and both need to
 * agree: the client caps the selection so the button says what will happen, and
 * the action re-checks because a cap enforced only in the browser is not a cap.
 */

/** Six voices side by side, per spec section 11.3. */
export const MAX_AUDITIONS = 6

/**
 * Long enough to judge a voice, short enough that a catalogue of them is
 * pennies — and short enough that the cached audio does not turn the settings
 * tables into the largest thing in the database.
 *
 * Two sentences is what you actually listen to before deciding.
 */
export const MAX_SAMPLE_CHARS = 280

/** A different sentence is a different audition, and a different cache entry. */
export function sampleHash(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 16)
}

export interface Audition {
  provider: TtsProvider
  voiceId: string
  label: string
  /** Base64 WAV, played from a data URL: an audition has no take row to address it by. */
  audio?: string
  durationMs?: number
  costUsd?: number
  error?: string
  /** True when it came from the cache, so nothing was spent replaying it. */
  cached?: boolean
  /** Hints the vendor refused — the audio is still good (principle 6). */
  droppedPronunciations?: string[]
}

export interface AuditionResult {
  ok: boolean
  error?: string
  auditions?: Audition[]
}

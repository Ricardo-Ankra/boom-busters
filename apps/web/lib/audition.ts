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

/** Long enough to judge a voice, short enough that six of them are pennies. */
export const MAX_SAMPLE_CHARS = 600

export interface Audition {
  provider: TtsProvider
  voiceId: string
  label: string
  /** Base64 WAV, played from a data URL: an audition has no take row to address it by. */
  audio?: string
  durationMs?: number
  costUsd?: number
  error?: string
}

export interface AuditionResult {
  ok: boolean
  error?: string
  auditions?: Audition[]
}

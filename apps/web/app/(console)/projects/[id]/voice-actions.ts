'use server'

import { flagTake, getVoiceTake, unflagTake } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import { db } from '@/lib/db'
import type { ActionResult } from '../actions'

/**
 * The two buttons on a voice review row (build spec section 11.3).
 *
 * Flagging does two things in one press, deliberately: it records why the take
 * is unacceptable *and* enqueues the retake. The spec asks for exactly that —
 * "flagging opens a note field and enqueues the retake immediately" — because
 * the alternative is a listen-through that ends with a dozen flagged rows and a
 * second pass to ask for each replacement.
 *
 * The note is required. A retake with no direction is the same synthesis rolled
 * again, and the vendor will usually return something very close to what was
 * just rejected.
 */

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
}

export async function flagVoiceTake(takeId: string, note: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const trimmed = note.trim()
  if (trimmed === '') {
    return {
      ok: false,
      error: 'Say what was wrong with it — a retake with no direction usually comes back the same.',
    }
  }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  await flagTake(db, takeId, trimmed)

  try {
    await inngest.send(
      events.voiceRetakeRequested.create({ projectId: take.projectId, takeId, note: trimmed }),
    )
  } catch (error) {
    console.error('[voice] could not enqueue the retake', error)
    refresh(take.projectId)
    // The flag stands. It is the honest state — the take *is* rejected — and
    // it keeps the gate closed until a retake arrives or the flag is cleared.
    return {
      ok: false,
      error:
        'Flagged, but the retake could not be queued: Inngest is unreachable. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }

  refresh(take.projectId)
  return { ok: true }
}

/**
 * Clear a flag without buying anything.
 *
 * The way back from a mis-click, and from a second listen that changed your
 * mind. Without it the only route past an accidental flag is to pay for a
 * retake of audio that was fine.
 */
export async function clearVoiceFlag(takeId: string): Promise<ActionResult> {
  await requireOwner()

  if (!UlidSchema.safeParse(takeId).success) return { ok: false, error: 'Unknown take' }

  const take = await getVoiceTake(db, takeId)
  if (!take) return { ok: false, error: 'That take no longer exists.' }

  if (take.status !== 'flagged') return { ok: false, error: 'That take is not flagged.' }

  await unflagTake(db, takeId)
  refresh(take.projectId)
  return { ok: true }
}

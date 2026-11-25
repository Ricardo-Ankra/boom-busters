import 'server-only'
import { NonRetriableError } from 'inngest'
import { channelForProject, getProject, getShort } from '@boom-busters/db'
import type { PublishRecordRow } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { requireCompleteBible } from '@/inngest/lib/channel'

/**
 * The guards every Publish action starts with, shared by `publish-actions.ts`
 * and `thumbnail-actions.ts`. Moved out of `publish-actions.ts` unchanged: that
 * module is `'use server'` and may export only async actions.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

export async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

export function parseTarget(targetType: string, targetId: string): ActionResult | null {
  if (targetType !== 'master' && targetType !== 'short') {
    return { ok: false, error: `Unknown publish target "${targetType}"` }
  }
  if (!UlidSchema.safeParse(targetId).success) return { ok: false, error: 'Unknown target' }
  return null
}

/** A target's project, so every action can revalidate the right screen. */
export async function projectIdOf(
  targetType: 'master' | 'short',
  targetId: string,
): Promise<string | undefined> {
  if (targetType === 'master') {
    return (await getProject(db, targetId)) ? targetId : undefined
  }
  return (await getShort(db, targetId))?.projectId
}

const EDITABLE = ['draft', 'failed'] as const
export function editableReason(record: PublishRecordRow | undefined): string | null {
  if (!record) return null
  if ((EDITABLE as readonly string[]).includes(record.status)) return null
  return record.status === 'scheduled' || record.status === 'live'
    ? 'This item is already on YouTube — edit it in Studio.'
    : 'This item is uploading right now.'
}

/**
 * The project's frozen bible, refused when incomplete. A server action answers
 * with an error result, so the owner reads the bible gate's own words; the
 * gate sits before the mock branch, as every stage's does.
 */
export async function completeFrozenBible(
  projectId: string,
): Promise<{ ok: true; frozen: Awaited<ReturnType<typeof channelForProject>> } | ActionResult> {
  const frozen = await channelForProject(db, projectId)
  try {
    return { ok: true, frozen: requireCompleteBible(frozen) }
  } catch (error) {
    if (error instanceof NonRetriableError && error.message === FROZEN_BIBLE_INCOMPLETE_MESSAGE) {
      return { ok: false, error: FROZEN_BIBLE_INCOMPLETE_MESSAGE }
    }
    throw error
  }
}

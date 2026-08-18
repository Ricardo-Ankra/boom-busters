'use server'

import { insertTimeline, latestTimeline, listMusicBeds, setTimelineKey } from '@boom-busters/db'
import { TimelineSchema, UlidSchema } from '@boom-busters/schemas'
import { swapMusicBed } from '@boom-busters/timeline'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { timelineKey } from '@/inngest/lib/assembly'
import { putObject, storageConfigured } from '@/lib/storage'

/**
 * The preview screen's music picker (build spec section 11.3): choosing a
 * bed recompiles the timeline, "which is cheap and free" — a pure swap of
 * the music block, everything else untouched, stored as a NEW version.
 * Versions are append-only: a render in flight stays pinned to the version
 * it was invoked with, whatever the picker does afterwards.
 *
 * The "Render master" button itself is not here — it IS the gate approval
 * (`approveGate(projectId, 'preview')` in `../actions.ts`): section 7.6
 * triggers the render-runner on `gate/preview.approved`, so the button that
 * spends the money and the event that closes the gate are one action.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

export async function chooseMusicBed(
  projectId: string,
  bedKey: string | null,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }

  const row = await latestTimeline(db, projectId)
  if (!row) {
    return { ok: false, error: 'There is no compiled timeline yet — run the assembly stage.' }
  }

  if (bedKey !== null) {
    // The picker offers the library; the action verifies against it, so a
    // stale form cannot write a key the library no longer holds.
    const beds = await listMusicBeds(db)
    if (!beds.some((bed) => bed.r2Key === bedKey)) {
      return { ok: false, error: 'That music bed is no longer in the library.' }
    }
  }

  const swapped = swapMusicBed(
    TimelineSchema.parse(row.json),
    bedKey === null ? null : { r2Key: bedKey },
  )

  const stored = await insertTimeline(db, { projectId, json: swapped, s3Key: '' })
  const key = timelineKey(projectId, stored.version)
  if (storageConfigured()) {
    await putObject(key, Buffer.from(JSON.stringify(swapped)), 'application/json')
  }
  await setTimelineKey(db, stored.id, key)

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

'use server'

import { getShort, updateShort } from '@boom-busters/db'
import { TeaserScriptRecordSchema, UlidSchema } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'

/**
 * The Shorts screen's actions (build spec section 11.3): edit a card's
 * metadata, toggle its ending, tick the related-link checklist, and ask for
 * a (re-)render. Scheduling is NOT here — that is the Publish screen (M7.7).
 * The related-link chip is bookkeeping, not a scheduling precondition
 * (decision 226): the Publish screen also calls `setShortRelatedLink` from
 * its post-upload reminder.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

async function loadShort(shortId: string) {
  if (!UlidSchema.safeParse(shortId).success) return undefined
  return getShort(db, shortId)
}

export async function updateShortDetails(
  shortId: string,
  details: { title: string; description: string },
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  const title = details.title.trim()
  if (title === '') return { ok: false, error: 'A Short needs a title.' }
  if (title.length > 100) {
    // YouTube truncates at 100 characters; storing more would publish less.
    return { ok: false, error: 'YouTube titles are limited to 100 characters.' }
  }

  await updateShort(db, shortId, { title, description: details.description.trim() })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * The ending is part of what gets rendered, so changing it makes the last
 * render a render of something else: the card's pointer is nulled and the
 * card offers "Render" again. The old render row keeps existing — the money
 * it cost is still real.
 */
export async function setShortEnding(
  shortId: string,
  ending: 'loop' | 'cta',
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.ending === ending) return { ok: true }

  await updateShort(db, shortId, { ending, renderId: null })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

export async function setShortRelatedLink(
  shortId: string,
  checked: boolean,
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  await updateShort(db, shortId, { relatedLinkChecked: checked })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * The teaser studio's script save (decision 227). Edits are stored on the
 * row and the render pointer is nulled — the last render is a render of the
 * old words, the same rule the ending toggle lives by. Nothing is re-voiced
 * here: the Re-voice & recut button spends, a Save never does.
 */
export async function saveTeaserScript(
  shortId: string,
  paragraphs: { text: string; chapterIndex: number }[],
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') {
    return { ok: false, error: 'Only a teaser has an editable script.' }
  }

  const stored = TeaserScriptRecordSchema.safeParse(short.teaserScript)
  const record = TeaserScriptRecordSchema.safeParse({
    title: stored.success ? stored.data.title : short.title.slice(0, 90),
    paragraphs,
    scriptVersion: stored.success ? stored.data.scriptVersion : 1,
  })
  if (!record.success) {
    return {
      ok: false,
      error:
        'That script does not fit a teaser — 2 to 5 beats, each 10 to 400 characters, read aloud.',
    }
  }

  await updateShort(db, shortId, {
    teaserScript: record.data as unknown as Record<string, unknown>,
    renderId: null,
  })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/** Ask the teaser-rebuild-runner to re-voice the stored script and recut. */
export async function rebuildTeaser(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') {
    return { ok: false, error: 'Only a teaser can be rebuilt — excerpts re-render instead.' }
  }

  try {
    await inngest.send(
      events.teaserRebuildRequested.create({ projectId: short.projectId, shortId }),
    )
  } catch (error) {
    console.error('[teaser] could not request the rebuild', error)
    return { ok: false, error: 'Could not reach Inngest to start the rebuild.' }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

export async function requestShortRender(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  try {
    await inngest.send(events.shortsRenderRequested.create({ projectId: short.projectId, shortId }))
  } catch (error) {
    console.error('[shorts] could not request a render', error)
    return { ok: false, error: 'Could not reach Inngest to start the render.' }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

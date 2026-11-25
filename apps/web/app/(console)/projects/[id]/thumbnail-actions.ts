'use server'

import {
  approvePackages,
  ensurePublishRecord,
  ensureUploadedPackages,
  getPublishRecord,
  getThumbnailPackage,
  listThumbnailPackages,
  makeDefaultPackage,
  publishRecords,
  recordTestOutcome,
  removeThumbnailPackage,
  syncApprovedToRecord,
  updatePublishRecord,
  updateThumbnailPackage,
  visualCredentials,
} from '@boom-busters/db'
import type { PublishRecordRow, ThumbnailPackageRow } from '@boom-busters/db'
import { PACKAGES_MAX, THUMBNAIL_IDEAS, UlidSchema, packageInFlight } from '@boom-busters/schemas'
import type { TestResult, ThumbnailIdea } from '@boom-busters/schemas'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import {
  completeFrozenBible,
  editableReason,
  parseTarget,
  projectIdOf,
  requireOwner,
} from '@/lib/publish-action-guards'
import type { ActionResult } from '@/lib/publish-action-guards'
import { metadataGrounding } from '@/lib/publish-grounding'
import { deleteObject } from '@/lib/storage'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'

/**
 * The Publish card's thumbnail buttons (design 2026-11-24, 7.1 and 7.7). The
 * actions only validate, write rows and send an event; the slow work (planning,
 * painting, composing) is the `thumbnail-set-runner`'s. Masters only.
 *
 * Every action that takes a package id derives the project and the record from
 * the package, never from the client, and applies the editable rule to it.
 */

// Words the card shows; copied verbatim from the design and the task brief.
const SHORT_REFUSAL = "Generated sets are for the full film. A Short's thumbnail is an upload."
const IN_FLIGHT_REFUSAL = 'A set is being made. Wait for it to finish.'
const UNKNOWN_THUMBNAIL = 'Unknown thumbnail'
const TITLE_MAX = 100
const HEADLINE_MAX = 60

const unknownThumbnail = (): ActionResult => ({ ok: false, error: UNKNOWN_THUMBNAIL })

/** A package with the master record it belongs to, once the editable rule has passed. */
type Loaded = { row: ThumbnailPackageRow; record: PublishRecordRow; projectId: string }

async function loadPackage(packageId: string): Promise<Loaded | ActionResult> {
  if (!UlidSchema.safeParse(packageId).success) return unknownThumbnail()
  const row = await getThumbnailPackage(db, packageId)
  if (!row) return unknownThumbnail()
  const [record] = await db
    .select()
    .from(publishRecords)
    .where(eq(publishRecords.id, row.publishRecordId))
  if (!record || record.targetType !== 'master') return unknownThumbnail()
  const projectId = await projectIdOf('master', record.targetId)
  if (!projectId) return unknownThumbnail()
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }
  return { row, record, projectId }
}

const isLoaded = (value: Loaded | ActionResult): value is Loaded => 'row' in value

/** Sends one event for a package; a failure to reach Inngest is said in words. */
async function sendPackageEvent(
  loaded: Loaded,
  mode: 'paint' | 'compose',
): Promise<ActionResult | null> {
  try {
    await inngest.send(
      events.thumbnailSetRequested.create({
        projectId: loaded.projectId,
        targetId: loaded.record.targetId,
        mode,
        packageId: loaded.row.id,
      }),
    )
    return null
  } catch (error) {
    console.error('[thumbnails] could not request the work', error)
    return { ok: false, error: 'Could not reach Inngest to start the work.' }
  }
}

async function deleteOrphans(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deleteObject(key)
    } catch {
      // Bytes left behind cost fractions of a cent; no row points at them.
    }
  }
}

export async function generateThumbnailSet(
  targetType: string,
  targetId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  if (targetType === 'short') return { ok: false, error: SHORT_REFUSAL }
  const projectId = await projectIdOf('master', targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await ensurePublishRecord(db, 'master', targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  // Stored keys from before the table existed count towards the three.
  await ensureUploadedPackages(db, record)
  const rows = await listThumbnailPackages(db, record.id)
  if (rows.filter((row) => row.approvedAt !== null).length >= PACKAGES_MAX) {
    return {
      ok: false,
      error: 'Three thumbnails are already approved. Remove one to generate more.',
    }
  }
  const now = new Date()
  if (rows.some((row) => packageInFlight(row, now))) {
    return { ok: false, error: IN_FLIGHT_REFUSAL }
  }

  const bibleGate = await completeFrozenBible(projectId)
  if (!('frozen' in bibleGate)) return bibleGate

  if (!mockProvidersEnabled()) {
    const provider = bibleGate.frozen.settings.modelRouting.thumbnails.provider
    const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    const stored = provider === 'google' ? keys.google : keys.fal
    if (!stored) {
      const name = provider === 'google' ? 'Gemini' : 'fal.ai'
      return {
        ok: false,
        error: `Thumbnails run on ${name}, but no ${name} key is stored in Settings, Connections.`,
      }
    }
    if ((await metadataGrounding(projectId)).claims.length === 0) {
      return { ok: false, error: 'There are no verified claims to build a thumbnail on.' }
    }
  }

  try {
    await inngest.send(events.thumbnailSetRequested.create({ projectId, targetId, mode: 'set' }))
  } catch (error) {
    console.error('[thumbnails] could not request the set', error)
    return { ok: false, error: 'Could not reach Inngest to start the set.' }
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function regenerateThumbnailPicture(packageId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPackage(packageId)
  if (!isLoaded(loaded)) return loaded
  if (loaded.row.source !== 'generated') {
    return { ok: false, error: 'Only a generated thumbnail has a picture to paint again.' }
  }
  if (packageInFlight(loaded.row, new Date())) return { ok: false, error: IN_FLIGHT_REFUSAL }

  // Marked at once, so a second click before the run starts is refused.
  await updateThumbnailPackage(db, packageId, { state: 'painting', error: null })
  const failed = await sendPackageEvent(loaded, 'paint')
  if (failed) {
    await updateThumbnailPackage(db, packageId, {
      state: loaded.row.state,
      error: loaded.row.error,
    })
    return failed
  }

  revalidatePath(`/projects/${loaded.projectId}`)
  return { ok: true }
}

export async function saveThumbnailPackage(
  packageId: string,
  patch: {
    title?: string
    headline?: string
    textSide?: 'left' | 'right'
    idea?: ThumbnailIdea | null
  },
): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPackage(packageId)
  if (!isLoaded(loaded)) return loaded
  const { row, record, projectId } = loaded
  const uploaded = row.source === 'uploaded'

  const changes: Parameters<typeof updateThumbnailPackage>[2] = {}

  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (title.length > TITLE_MAX) {
      return { ok: false, error: `A title is at most ${TITLE_MAX} characters.` }
    }
    if (title !== row.title) changes.title = title
  }

  let retype = false
  if (patch.headline !== undefined) {
    const headline = patch.headline.trim()
    if (headline.length > HEADLINE_MAX) {
      return { ok: false, error: `A headline is at most ${HEADLINE_MAX} characters.` }
    }
    // More than HEADLINE_WORDS_MAX words is allowed here: the card warns, it does not block.
    if (headline !== row.headline) {
      if (uploaded) return { ok: false, error: 'An uploaded thumbnail has no headline to edit.' }
      changes.headline = headline
      retype = true
    }
  }

  if (patch.textSide !== undefined) {
    if (patch.textSide !== 'left' && patch.textSide !== 'right') {
      return { ok: false, error: 'The text side is left or right.' }
    }
    if (patch.textSide !== row.textSide) {
      if (uploaded) return { ok: false, error: 'An uploaded thumbnail has no text side to change.' }
      changes.textSide = patch.textSide
      retype = true
    }
  }

  if (patch.idea !== undefined) {
    if (!uploaded) {
      return { ok: false, error: 'Only an uploaded thumbnail takes an idea label.' }
    }
    if (patch.idea !== null && !(THUMBNAIL_IDEAS as readonly string[]).includes(patch.idea)) {
      return { ok: false, error: 'Unknown idea.' }
    }
    if (patch.idea !== row.idea) changes.idea = patch.idea
  }

  if (retype && packageInFlight(row, new Date())) {
    return { ok: false, error: IN_FLIGHT_REFUSAL }
  }
  if (Object.keys(changes).length === 0) return { ok: true }

  await updateThumbnailPackage(db, packageId, changes)

  if (changes.title !== undefined && changes.title !== '' && row.approvedAt !== null) {
    const approved = (await listThumbnailPackages(db, record.id)).filter(
      (item) => item.approvedAt !== null && item.composedKey !== null,
    )
    if (approved[0]?.id === packageId) await syncApprovedToRecord(db, record.id)
  }

  if (retype && row.source === 'generated' && row.pictureKey !== null) {
    const failed = await sendPackageEvent(loaded, 'compose')
    if (failed) return failed
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function makeDefaultThumbnail(packageId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPackage(packageId)
  if (!isLoaded(loaded)) return loaded
  if (packageInFlight(loaded.row, new Date())) return { ok: false, error: IN_FLIGHT_REFUSAL }

  await makeDefaultPackage(db, loaded.record.id, packageId)

  revalidatePath(`/projects/${loaded.projectId}`)
  return { ok: true }
}

export async function removeThumbnailPackageAction(packageId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPackage(packageId)
  if (!isLoaded(loaded)) return loaded
  if (packageInFlight(loaded.row, new Date())) return { ok: false, error: IN_FLIGHT_REFUSAL }

  const removed = await removeThumbnailPackage(db, packageId)
  if (!removed) return unknownThumbnail()
  await deleteOrphans(removed.orphanedKeys)

  revalidatePath(`/projects/${loaded.projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Test & Compare (design 7.7 and 7.8). Not bound by the editable rule: these
// exist for a record that is already on YouTube.
// ---------------------------------------------------------------------------

const TEST_NEEDS_VIDEO = 'A test needs the video on YouTube and at least two approved thumbnails.'
const TEST_NOT_STARTED = 'Mark the test as started first.'
const NOT_IN_TEST = 'That thumbnail is not part of this test.'
const SHARE_RANGE = 'A watch time share is a percentage from 0 to 100.'

/** The master record of a target, after the Short and unknown-project guards. */
async function loadMasterRecord(
  targetType: string,
  targetId: string,
): Promise<{ record: PublishRecordRow | undefined; projectId: string } | ActionResult> {
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  if (targetType === 'short') return { ok: false, error: SHORT_REFUSAL }
  const projectId = await projectIdOf('master', targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }
  return { record: await getPublishRecord(db, 'master', targetId), projectId }
}

export async function markTestStarted(targetType: string, targetId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadMasterRecord(targetType, targetId)
  if (!('projectId' in loaded)) return loaded
  const { record, projectId } = loaded

  const onYoutube =
    record?.status === 'uploaded' || record?.status === 'scheduled' || record?.status === 'live'
  const approved = record
    ? (await listThumbnailPackages(db, record.id)).filter((row) => row.approvedAt !== null)
    : []
  if (!record || !onYoutube || approved.length < 2) {
    return { ok: false, error: TEST_NEEDS_VIDEO }
  }
  // Pressing it twice leaves the first stamp.
  if (record.testStartedAt) return { ok: true }

  await updatePublishRecord(db, record.id, { testStartedAt: new Date() })

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function recordTestResult(
  targetType: string,
  targetId: string,
  input: {
    outcome: { winner: string } | 'same' | 'inconclusive'
    shares?: Record<string, number>
  },
): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadMasterRecord(targetType, targetId)
  if (!('projectId' in loaded)) return loaded
  const { record, projectId } = loaded
  if (!record || !record.testStartedAt) return { ok: false, error: TEST_NOT_STARTED }

  const approvedIds = (await listThumbnailPackages(db, record.id))
    .filter((row) => row.approvedAt !== null)
    .map((row) => row.id)

  const results: Record<string, TestResult> = {}
  if (input.outcome === 'same' || input.outcome === 'inconclusive') {
    for (const id of approvedIds) results[id] = input.outcome
  } else {
    const winner = typeof input.outcome === 'object' ? input.outcome?.winner : undefined
    if (typeof winner !== 'string' || !approvedIds.includes(winner)) {
      return { ok: false, error: NOT_IN_TEST }
    }
    for (const id of approvedIds) results[id] = id === winner ? 'won' : 'lost'
  }

  const shares: Record<string, number | null> = {}
  for (const [id, value] of Object.entries(input.shares ?? {})) {
    if (!approvedIds.includes(id)) return { ok: false, error: NOT_IN_TEST }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return { ok: false, error: SHARE_RANGE }
    }
    shares[id] = value
  }

  await recordTestOutcome(db, record.id, { results, shares, endedAt: new Date() })

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function approveThumbnailSet(
  targetType: string,
  targetId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  if (targetType === 'short') return { ok: false, error: SHORT_REFUSAL }
  const projectId = await projectIdOf('master', targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await ensurePublishRecord(db, 'master', targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  const rows = await listThumbnailPackages(db, record.id)
  const now = new Date()
  if (rows.some((row) => packageInFlight(row, now))) {
    return { ok: false, error: IN_FLIGHT_REFUSAL }
  }
  const fresh = rows.filter(
    (row) => row.approvedAt === null && row.composedKey !== null && row.state === 'ready',
  )
  if (fresh.length === 0) return { ok: false, error: 'There is nothing new to approve.' }

  const result = await approvePackages(db, record.id)
  if (!result.ok) {
    return { ok: false, error: `Three thumbnails at most. Remove ${result.over} before approving.` }
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

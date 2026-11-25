'use server'

/**
 * The Thumbnails tab's actions. A reference is a picture the owner kept as a
 * style example for one channel's generated thumbnails; the settings row holds
 * the list. Every write goes through the settings patch path
 * (`SettingsPatchSchema`, then `updateChannelSettings`), so the merge's own
 * rules (three in use at most) hold here too.
 *
 * The object key is the file's content hash, so the same file uploaded twice
 * would share one object: that is refused, and a removal keeps an object that
 * another row still holds.
 */

import { createHash } from 'node:crypto'
import {
  getChannelBySlug,
  getChannelSettings,
  getThumbnailPackage,
  publishRecords,
  updateChannelSettings,
} from '@boom-busters/db'
import {
  newId,
  SettingsPatchSchema,
  THUMB_REFERENCES_MAX,
  type ThumbMarkPlacement,
  type ThumbnailReference,
} from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { findChannel, writeRefusalFor } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { settingsErrorMessage } from '@/lib/settings-error'
import {
  deleteObject,
  getObjectBytes,
  putObject,
  storageConfigured,
  thumbnailReferenceKey,
} from '@/lib/storage'
import type { ActionResult } from './actions'

const MAX_BYTES = 8 * 1024 * 1024
const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const
type ReferenceMime = keyof typeof EXTENSIONS

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

/** The channel the slug names, or the refusal to give back. */
async function writableChannel(
  slug: string,
): Promise<{ id: string } | { refusal: { ok: false; error: string } }> {
  const channel = await getChannelBySlug(db, typeof slug === 'string' ? slug : '')
  const refusal = writeRefusalFor(channel)
  if (refusal || !channel) return { refusal: refusal ?? { ok: false, error: 'Unknown channel' } }
  return { id: channel.id }
}

function refresh(): void {
  revalidatePath('/c/[slug]', 'layout')
}

/** A refusal from the merge reads as the schema's own sentence, not as a path. */
function refusalMessage(error: unknown): string {
  if (error instanceof z.ZodError && error.issues[0]) return error.issues[0].message
  return settingsErrorMessage(error)
}

async function writeReferences(
  channelId: string,
  references: ThumbnailReference[],
): Promise<ActionResult> {
  const parsed = SettingsPatchSchema.safeParse({ thumbnails: { references } })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' }
  try {
    await updateChannelSettings(db, channelId, parsed.data)
  } catch (error) {
    return { ok: false, error: refusalMessage(error) }
  }
  refresh()
  return { ok: true }
}

export async function uploadThumbnailReference(formData: FormData): Promise<ActionResult> {
  await requireOwner()
  const found = await writableChannel(String(formData.get('slug') ?? ''))
  if ('refusal' in found) return found.refusal

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a picture first.' }
  }
  if (!(file.type in EXTENSIONS)) {
    return { ok: false, error: 'Reference thumbnails are PNG, JPEG or WebP files.' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'Reference thumbnails must be 8 MB or less.' }
  }
  if (!storageConfigured()) return STORAGE_REFUSAL
  // Read before the limit is checked, as the picture is hashed to find a duplicate.
  const bytes = Buffer.from(await file.arrayBuffer())
  return appendReference(found.id, { bytes, mimeType: file.type as ReferenceMime, note: '' })
}

const STORAGE_REFUSAL: ActionResult = {
  ok: false,
  error: 'Reference uploads need R2 configured; there is nowhere to store them.',
}

/**
 * Keeps a picture as the channel's next reference, not in use: refuses a
 * seventh and a file already held, stores the object under its content hash,
 * then writes the list through the settings patch path. The caller has
 * checked that storage is configured.
 */
async function appendReference(
  channelId: string,
  picture: { bytes: Buffer; mimeType: ReferenceMime; note: string },
): Promise<ActionResult> {
  const existing = (await getChannelSettings(db, channelId)).thumbnails.references
  if (existing.length >= THUMB_REFERENCES_MAX) {
    return { ok: false, error: 'Six reference thumbnails at most. Remove one first.' }
  }
  const contentHash = createHash('sha256').update(picture.bytes).digest('hex')
  const r2Key = thumbnailReferenceKey({
    channelId,
    contentHash,
    ext: EXTENSIONS[picture.mimeType],
  })
  if (existing.some((ref) => ref.r2Key === r2Key)) {
    return { ok: false, error: 'That exact file is already a reference.' }
  }

  await putObject(r2Key, picture.bytes, picture.mimeType)
  return writeReferences(channelId, [
    ...existing,
    {
      id: newId<'thumbnail-reference'>(),
      r2Key,
      mimeType: picture.mimeType,
      note: picture.note,
      inUse: false,
    },
  ])
}

const WINNER_REFUSAL = 'Only a thumbnail that won its test can be added.'

/**
 * Keeps a thumbnail that won its Test & Compare as a style reference. The
 * channel is the one the package's record belongs to, never the client's.
 */
export async function addWinnerToReferences(packageId: string): Promise<ActionResult> {
  await requireOwner()
  const pack = typeof packageId === 'string' ? await getThumbnailPackage(db, packageId) : undefined
  const [record] = pack
    ? await db.select().from(publishRecords).where(eq(publishRecords.id, pack.publishRecordId))
    : []
  if (
    !pack ||
    !record ||
    record.targetType !== 'master' ||
    pack.result !== 'won' ||
    pack.composedKey === null
  ) {
    return { ok: false, error: WINNER_REFUSAL }
  }
  const channel = await findChannel(record.channelId)
  const refusal = writeRefusalFor(channel)
  if (refusal || !channel) return refusal ?? { ok: false, error: 'Unknown channel' }
  if (!storageConfigured()) return STORAGE_REFUSAL

  const { bytes } = await getObjectBytes(pack.composedKey)
  return appendReference(channel.id, {
    bytes: Buffer.from(bytes),
    mimeType: 'image/jpeg',
    note: `Won its test: ${pack.title}`.slice(0, 200),
  })
}

export async function saveThumbnailReference(
  slug: string,
  id: string,
  patch: { note?: string; inUse?: boolean },
): Promise<ActionResult> {
  await requireOwner()
  const found = await writableChannel(slug)
  if ('refusal' in found) return found.refusal

  const { references } = (await getChannelSettings(db, found.id)).thumbnails
  if (!references.some((ref) => ref.id === id)) {
    return { ok: false, error: 'That reference is already gone.' }
  }
  return writeReferences(
    found.id,
    references.map((ref) =>
      ref.id === id
        ? {
            ...ref,
            ...(patch.note === undefined ? {} : { note: patch.note.trim() }),
            ...(patch.inUse === undefined ? {} : { inUse: patch.inUse }),
          }
        : ref,
    ),
  )
}

export async function removeThumbnailReference(slug: string, id: string): Promise<ActionResult> {
  await requireOwner()
  const found = await writableChannel(slug)
  if ('refusal' in found) return found.refusal

  const { references } = (await getChannelSettings(db, found.id)).thumbnails
  const gone = references.find((ref) => ref.id === id)
  if (!gone) return { ok: false, error: 'That reference is already gone.' }

  const kept = references.filter((ref) => ref.id !== id)
  const result = await writeReferences(found.id, kept)
  if (!result.ok) return result

  // Best-effort: the list is authoritative and already updated. The same file
  // under two rows shares one object, which stays while either row holds it.
  if (!kept.some((ref) => ref.r2Key === gone.r2Key)) {
    try {
      await deleteObject(gone.r2Key)
    } catch {
      // An orphaned object is a lifecycle-rule concern, not a correctness one.
    }
  }
  return result
}

export async function saveThumbnailStyle(
  slug: string,
  input: { styleNote: string; markPlacement: ThumbMarkPlacement },
): Promise<ActionResult> {
  await requireOwner()
  const found = await writableChannel(slug)
  if ('refusal' in found) return found.refusal

  const parsed = SettingsPatchSchema.safeParse({
    thumbnails: { styleNote: input.styleNote.trim(), markPlacement: input.markPlacement },
  })
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid settings',
    }
  }
  try {
    await updateChannelSettings(db, found.id, parsed.data)
  } catch (error) {
    return { ok: false, error: refusalMessage(error) }
  }
  refresh()
  return { ok: true }
}

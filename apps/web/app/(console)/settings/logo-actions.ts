'use server'

/**
 * The Logos tab's actions (decision 268). The upload is the music library's
 * two-step presigned shape, because bytes cannot travel through an action
 * (decision 205); a pasted address is fetched server-side through
 * `fetchRemoteLogo`, which draws SVG and AVIF to PNG so that what is stored
 * is always a raster mark.
 */

import { createHash } from 'node:crypto'
import {
  getSettings,
  insertLogo,
  listLogos,
  removeLogo,
  renameLogo,
  updateSettings,
} from '@boom-busters/db'
import {
  LOGO_MAX_BYTES,
  LogoStoredMimeSchema,
  logoExtension,
  UlidSchema,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { fetchRemoteLogo } from '@/lib/remote-image'
import {
  deleteObject,
  headObject,
  logoKey,
  presignPut,
  putObject,
  storageConfigured,
} from '@/lib/storage'
import type { ActionResult } from './actions'

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const HEX_64 = /^[0-9a-f]{64}$/
const MAX_TITLE = 80

/**
 * `insertLogo` upserts on `contentHash` alone, whose unique index ignores
 * `kind`: bytes already stored as another asset kind would otherwise be
 * renamed in place and never appear in `listLogos`.
 */
const NOT_A_MARK: ActionResult = {
  ok: false,
  error:
    'Those exact bytes are already stored as something other than a mark. Upload a different file.',
}

function cleanTitle(title: string): string | null {
  const trimmed = title.trim().replace(/\s+/g, ' ')
  return trimmed.length === 0 || trimmed.length > MAX_TITLE ? null : trimmed
}

function refresh(): void {
  revalidatePath('/settings')
  revalidatePath('/')
}

/**
 * Step one: a presigned PUT for a raster mark. SVG and AVIF are refused HERE
 * on purpose: the browser converts both before it asks, so a request naming
 * them is a browser that skipped the conversion, and the server will not
 * store what the render's Chromium would execute or no model reads.
 */
export async function createLogoUploadAction(input: {
  fileType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()

  const mime = LogoStoredMimeSchema.safeParse(input.fileType)
  if (!mime.success) {
    return {
      ok: false,
      error: 'A mark is stored as PNG, WebP or JPEG. SVG and AVIF are converted before upload.',
    }
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > LOGO_MAX_BYTES) {
    return { ok: false, error: 'That mark is over the 4 MB limit.' }
  }
  if (!HEX_64.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }
  const key = logoKey({ contentHash: input.contentHash, ext: logoExtension(mime.data) })
  return { ok: true, url: await presignPut(key, mime.data), key }
}

/** Step two: the object landed; record the mark under the entity's name. */
export async function finaliseLogoAction(input: {
  key: string
  contentHash: string
  title: string
  width: number
  height: number
}): Promise<ActionResult> {
  await requireOwner()

  const title = cleanTitle(input.title)
  if (!title)
    return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  if (!HEX_64.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  // Only keys this flow could have issued: exactly one of the three legal
  // extensions on the content hash, never merely a key that starts the same way.
  const legal = (['png', 'webp', 'jpg'] as const).map((ext) =>
    logoKey({ contentHash: input.contentHash, ext }),
  )
  if (!legal.includes(input.key)) {
    return { ok: false, error: 'That upload does not match its fingerprint. Start again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }
  const head = await headObject(input.key)
  if (!head) return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  if (head.size > LOGO_MAX_BYTES) {
    await deleteObject(input.key)
    return { ok: false, error: 'That mark is over the 4 MB limit.' }
  }

  const row = await insertLogo(db, {
    r2Key: input.key,
    contentHash: input.contentHash,
    title,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
  })
  if (!row) return NOT_A_MARK
  refresh()
  return { ok: true }
}

/** A mark by its web address, fetched once and stored like an upload. */
export async function addLogoFromUrlAction(input: {
  url: string
  title: string
}): Promise<ActionResult> {
  await requireOwner()

  const title = cleanTitle(input.title)
  if (!title)
    return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }

  const fetched = await fetchRemoteLogo(input.url)
  if (!fetched.ok) return { ok: false, error: fetched.error }
  const { bytes, mimeType, width, height, resolvedUrl } = fetched.logo

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const key = logoKey({ contentHash, ext: logoExtension(mimeType) })
  await putObject(key, bytes, mimeType)
  const row = await insertLogo(db, {
    r2Key: key,
    contentHash,
    title,
    width,
    height,
    sourceUrl: resolvedUrl,
  })
  if (!row) return NOT_A_MARK
  refresh()
  return { ok: true }
}

export async function renameLogoAction(input: {
  id: string
  title: string
}): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(input.id).success) return { ok: false, error: 'Unknown mark.' }
  const title = cleanTitle(input.title)
  if (!title)
    return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  const row = await renameLogo(db, input.id, title)
  if (!row) return { ok: false, error: 'That mark is already gone.' }
  refresh()
  return { ok: true }
}

/** Remove a mark. The channel mark is refused: the watermark would point at nothing. */
export async function removeLogoAction(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown mark.' }

  const settings = await getSettings(db)
  const logo = (await listLogos(db)).find((row) => row.id === id)
  if (!logo) return { ok: false, error: 'That mark is already gone.' }
  if (settings.brandKit.look.logoR2Key === logo.r2Key) {
    return {
      ok: false,
      error: 'This is the channel mark. Choose another mark, or none, before removing it.',
    }
  }

  const row = await removeLogo(db, id)
  if (!row) return { ok: false, error: 'That mark is already gone.' }
  // Best-effort: the row is authoritative and already gone.
  try {
    await deleteObject(row.r2Key)
  } catch {
    // Orphaned bytes are a lifecycle-rule concern, not a correctness one.
  }
  refresh()
  return { ok: true }
}

/** The mark the watermark draws, or none for the typographic wordmark. */
export async function setChannelMarkAction(id: string | null): Promise<ActionResult> {
  await requireOwner()

  let logoR2Key: string | null = null
  if (id !== null) {
    if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown mark.' }
    const logo = (await listLogos(db)).find((row) => row.id === id)
    if (!logo) return { ok: false, error: 'That mark is already gone.' }
    logoR2Key = logo.r2Key
  }
  const settings = await getSettings(db)
  await updateSettings(db, { brandKit: { look: { ...settings.brandKit.look, logoR2Key } } })
  refresh()
  return { ok: true }
}

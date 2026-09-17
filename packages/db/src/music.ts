import { desc, eq, and, isNull } from 'drizzle-orm'
import type { Database } from './client'
import { assets } from './schema'
import type { AssetRow } from './schema'

/**
 * The music library's queries (build spec section 10.1). Beds are `assets`
 * rows of kind `music`, deduped by content hash like every other asset —
 * uploading the same file twice refreshes its title and tags rather than
 * storing it twice.
 */

export async function listMusicBeds(db: Database): Promise<AssetRow[]> {
  return db.select().from(assets).where(eq(assets.kind, 'music')).orderBy(desc(assets.createdAt))
}

export async function insertMusicBed(
  db: Database,
  input: {
    r2Key: string
    contentHash: string
    title: string
    licence: string
    moodTags: string[]
    durationMs?: number | null
    /** Published in the description of every video using this track. */
    attributionText?: string | null
  },
): Promise<AssetRow> {
  const [row] = await db
    .insert(assets)
    .values({
      kind: 'music',
      r2Key: input.r2Key,
      contentHash: input.contentHash,
      title: input.title,
      licence: input.licence,
      moodTags: input.moodTags,
      durationMs: input.durationMs ?? null,
      attributionText: input.attributionText ?? null,
    })
    .onConflictDoUpdate({
      target: assets.contentHash,
      // The bytes already exist under their hash key; a re-upload is the
      // human renaming or re-tagging, so those fields win. The original
      // r2Key is kept — same bytes, same home.
      set: {
        title: input.title,
        licence: input.licence,
        moodTags: input.moodTags,
        attributionText: input.attributionText ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error('The music bed could not be stored')
  return row
}

/**
 * Record a bed's length, measured by the browser that listed it.
 *
 * Beds uploaded before the renderer needed a length carry none, and nothing
 * server-side can read one out of an MP3 (decision 256). Only ever fills a
 * blank: a stored length is the one the file had when it was uploaded, and
 * the bytes are content-addressed, so it cannot go stale.
 */
export async function setMusicBedDuration(
  db: Database,
  id: string,
  durationMs: number,
): Promise<AssetRow | undefined> {
  const [row] = await db
    .update(assets)
    .set({ durationMs, updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.kind, 'music'), isNull(assets.durationMs)))
    .returning()
  return row
}

/**
 * The bed a timeline points at. Timelines store the music track by `r2Key`
 * (keys, never URLs — spec section 8.2), so the publish stage looks the
 * library row up by key to carry its attribution into the description.
 */
export async function musicBedByR2Key(db: Database, r2Key: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, 'music'), eq(assets.r2Key, r2Key)))
    .limit(1)
  return row
}

/**
 * Remove a bed. Returns the row so the caller can delete the R2 object —
 * the database is authoritative and goes first; orphaned bytes are a
 * lifecycle-rule problem, missing rows with live bytes are not a problem
 * at all.
 */
export async function deleteMusicBed(db: Database, id: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .delete(assets)
    .where(and(eq(assets.id, id), eq(assets.kind, 'music')))
    .returning()
  return row
}

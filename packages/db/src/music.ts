import { desc, eq, and } from 'drizzle-orm'
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
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error('The music bed could not be stored')
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

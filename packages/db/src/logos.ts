import { and, asc, eq, sql } from 'drizzle-orm'
import { logoForEntity } from '@boom-busters/schemas'
import type { Database } from './client'
import { assets } from './schema'
import type { AssetRow } from './schema'

/**
 * The logo library's queries (decision 268). Marks are `assets` rows of kind
 * `logo`, deduped by content hash like every other asset: uploading the same
 * file twice refreshes its name rather than storing it twice. The library is
 * per channel: a bank that appears in three of a channel's films is uploaded once to that
 * channel. The same bytes on two channels are two rows over one R2 object.
 */

const LOGO_LICENCE = 'Uploaded by owner'

/** Every mark of one channel, by name: the tab is a directory, not a feed. */
export async function listLogos(db: Database, channelId: string): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, 'logo'), eq(assets.channelId, channelId)))
    .orderBy(asc(assets.title), asc(assets.createdAt))
}

/** A single mark by id, for a caller that already knows which one it wants. */
export async function logoById(db: Database, id: string): Promise<AssetRow | null> {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), eq(assets.kind, 'logo')))
    .limit(1)
  return row ?? null
}

/**
 * Upsert a channel's mark by content hash. The conflict target is the partial
 * unique index on `(content_hash, channel_id)`, so the same bytes on another
 * channel, or among the shared assets, never collide. Returns the stored row,
 * or `null` when the conflicting row is not a logo; nothing was touched then.
 */
export async function insertLogo(
  db: Database,
  channelId: string,
  input: {
    r2Key: string
    contentHash: string
    /** The entity's name as the dossier writes it: the join key. */
    title: string
    width: number
    height: number
    /** Where the owner found it, when pasted from an address. Provenance only. */
    sourceUrl?: string | null
  },
): Promise<AssetRow | null> {
  const title = input.title.trim()
  const [row] = await db
    .insert(assets)
    .values({
      channelId,
      kind: 'logo',
      r2Key: input.r2Key,
      contentHash: input.contentHash,
      title,
      licence: LOGO_LICENCE,
      width: input.width,
      height: input.height,
      sourceUrl: input.sourceUrl ?? null,
    })
    .onConflictDoUpdate({
      target: [assets.contentHash, assets.channelId],
      // Postgres needs the partial index's predicate to infer it.
      targetWhere: sql`channel_id is not null`,
      // The bytes already exist under their hash key; a re-upload is the
      // owner renaming the mark, so the name wins. The key stays. Only when
      // the conflicting row is itself a logo: `setWhere` keeps a collision
      // with another asset kind from being renamed and resized in place.
      set: {
        title,
        width: input.width,
        height: input.height,
        sourceUrl: input.sourceUrl ?? null,
        updatedAt: new Date(),
      },
      setWhere: eq(assets.kind, 'logo'),
    })
    .returning()

  return row ?? null
}

export async function renameLogo(
  db: Database,
  id: string,
  title: string,
): Promise<AssetRow | undefined> {
  const [row] = await db
    .update(assets)
    .set({ title: title.trim(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.kind, 'logo')))
    .returning()
  return row
}

/**
 * Remove a mark. Returns the row so the caller can delete the object: the
 * database is authoritative and goes first. Whether the mark is the channel
 * mark is the caller's check, since that lives in settings.
 */
export async function removeLogo(db: Database, id: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .delete(assets)
    .where(and(eq(assets.id, id), eq(assets.kind, 'logo')))
    .returning()
  return row
}

/** The mark an entity name refers to, through the same matcher Plan B's resolver uses. */
export async function findLogoByName(
  db: Database,
  channelId: string,
  name: string,
): Promise<AssetRow | null> {
  const logos = await listLogos(db, channelId)
  return logoForEntity(
    name,
    logos.map((logo) => ({ ...logo, title: logo.title ?? '' })),
  )
}

export async function logoByR2Key(
  db: Database,
  channelId: string,
  r2Key: string,
): Promise<AssetRow | undefined> {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, 'logo'), eq(assets.channelId, channelId), eq(assets.r2Key, r2Key)))
    .limit(1)
  return row
}

/**
 * Whether any asset row still points at this object. Two channels that upload
 * the same bytes share one R2 object, so removing one channel's mark must not
 * delete the bytes while another row uses them.
 */
export async function assetObjectInUse(db: Database, r2Key: string): Promise<boolean> {
  const [row] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.r2Key, r2Key))
    .limit(1)
  return row !== undefined
}

import { and, asc, eq } from 'drizzle-orm'
import { logoForEntity } from '@boom-busters/schemas'
import type { Database } from './client'
import { assets } from './schema'
import type { AssetRow } from './schema'

/**
 * The logo library's queries (decision 268). Marks are `assets` rows of kind
 * `logo`, deduped by content hash like every other asset: uploading the same
 * file twice refreshes its name rather than storing it twice. The library is
 * channel-wide by design; a bank that appears in three films is uploaded once.
 */

const LOGO_LICENCE = 'Uploaded by owner'

/** Every mark, by name: the tab is a directory, not a feed. */
export async function listLogos(db: Database): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(eq(assets.kind, 'logo'))
    .orderBy(asc(assets.title), asc(assets.createdAt))
}

export async function insertLogo(
  db: Database,
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
): Promise<AssetRow> {
  const title = input.title.trim()
  const [row] = await db
    .insert(assets)
    .values({
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
      target: assets.contentHash,
      // The bytes already exist under their hash key; a re-upload is the
      // owner renaming the mark, so the name wins. The key stays.
      set: {
        title,
        width: input.width,
        height: input.height,
        sourceUrl: input.sourceUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error('The logo could not be stored')
  return row
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
export async function findLogoByName(db: Database, name: string): Promise<AssetRow | null> {
  const logos = await listLogos(db)
  return logoForEntity(
    name,
    logos.map((logo) => ({ ...logo, title: logo.title ?? '' })),
  )
}

export async function logoByR2Key(db: Database, r2Key: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, 'logo'), eq(assets.r2Key, r2Key)))
    .limit(1)
  return row
}

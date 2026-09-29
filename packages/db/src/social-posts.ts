import { eq, inArray } from 'drizzle-orm'
import { parsePostUrl, SocialPostRecordSchema, ValidationError } from '@boom-busters/schemas'
import type { PostField, SocialPostRecord } from '@boom-busters/schemas'
import type { Database } from './client'
import { socialPosts } from './schema'
import type { SocialPostRow } from './schema'

/**
 * The social post store (decision 284), `articles.ts`'s twin for a real X
 * post shown on a card.
 *
 * The sticky rule is the same instinct as the article store's, but it works
 * per field rather than per row: a fetch (`recordSocialPost`) fills in
 * whatever the owner has not typed and leaves the rest exactly as they left
 * it, so a post the owner corrected once still benefits from a later,
 * better read of the fields they never touched. `setSocialPostManual` is the
 * owner's own correction, final until cleared.
 */

function toRecord(row: SocialPostRow): SocialPostRecord {
  return SocialPostRecordSchema.parse({
    url: row.url,
    platform: row.platform,
    postId: row.postId,
    handle: row.handle,
    authorName: row.authorName,
    text: row.text,
    postedAt: row.postedAt,
    endedWithMediaLink: row.endedWithMediaLink,
    provenance: row.provenance,
    status: row.status,
    failureReason: row.failureReason,
  })
}

export async function getSocialPost(db: Database, url: string): Promise<SocialPostRecord | null> {
  const [row] = await db.select().from(socialPosts).where(eq(socialPosts.url, url)).limit(1)
  return row ? toRecord(row) : null
}

export async function getSocialPosts(
  db: Database,
  urls: readonly string[],
): Promise<SocialPostRecord[]> {
  if (urls.length === 0) return []
  const rows = await db
    .select()
    .from(socialPosts)
    .where(inArray(socialPosts.url, [...urls]))
  return rows.map(toRecord)
}

/**
 * Store what a fetch found (or that it failed). For each of the four
 * owner-correctable fields, a field whose stored provenance is `'manual'`
 * is kept exactly as it is, and so is a stored value the reader came back
 * null for (a blank read never wipes a field); every other field, and the
 * row's own status and failure reason, take the reader's value.
 */
export async function recordSocialPost(
  db: Database,
  record: SocialPostRecord,
): Promise<SocialPostRecord> {
  const existing = await getSocialPost(db, record.url)

  const field = <K extends PostField>(
    key: K,
  ): { value: SocialPostRecord[K]; provenance?: string } => {
    if (existing && existing.provenance[key] === 'manual') {
      return { value: existing[key], provenance: 'manual' }
    }
    // A reader that came back blank for a field this row already holds has
    // not told us the field is gone, only that it could not see it: the
    // stored value, and where it came from, stand.
    if (existing && record[key] === null && existing[key] !== null) {
      return { value: existing[key], provenance: existing.provenance[key] }
    }
    return { value: record[key], provenance: record.provenance[key] }
  }

  const authorName = field('authorName')
  const handle = field('handle')
  const text = field('text')
  const postedAt = field('postedAt')

  const provenance: Record<string, string> = {}
  if (authorName.provenance) provenance['authorName'] = authorName.provenance
  if (handle.provenance) provenance['handle'] = handle.provenance
  if (text.provenance) provenance['text'] = text.provenance
  if (postedAt.provenance) provenance['postedAt'] = postedAt.provenance

  const values = {
    url: record.url,
    platform: record.platform,
    postId: record.postId,
    handle: handle.value,
    authorName: authorName.value,
    text: text.value,
    postedAt: postedAt.value,
    endedWithMediaLink: record.endedWithMediaLink,
    provenance,
    status: record.status,
    failureReason: record.failureReason,
    fetchedAt: new Date(),
  }

  const [row] = await db
    .insert(socialPosts)
    .values(values)
    .onConflictDoUpdate({
      target: socialPosts.url,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
  return toRecord(row!)
}

/**
 * The owner's corrections, which are final. Writing any field flips the row
 * to `manual` status, marks the fields written as manually provenanced, and
 * clears the failure: a record somebody has typed is not a failed fetch any
 * more. Absent fields are untouched; an explicit `null` clears one.
 */
export async function setSocialPostManual(
  db: Database,
  url: string,
  fields: Partial<Pick<SocialPostRecord, 'authorName' | 'handle' | 'text' | 'postedAt'>>,
): Promise<SocialPostRecord> {
  const existing = await getSocialPost(db, url)
  const provenance = { ...(existing?.provenance ?? {}) }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (value === null) delete provenance[key as PostField]
    else provenance[key as PostField] = 'manual'
  }

  /** An absent field is untouched; an explicit null clears it. */
  const written = <K extends keyof typeof fields>(key: K): string | null =>
    fields[key] === undefined ? (existing?.[key] ?? null) : fields[key]

  if (!existing) {
    const parsed = parsePostUrl(url)
    if (!parsed) {
      throw new ValidationError('That is not the address of a post.', { field: 'url' })
    }
    const values = {
      url,
      platform: 'x' as const,
      postId: parsed.postId,
      authorName: written('authorName'),
      handle: written('handle'),
      text: written('text'),
      postedAt: written('postedAt'),
      endedWithMediaLink: false,
      provenance,
      status: 'manual' as const,
      failureReason: null,
    }
    const [row] = await db
      .insert(socialPosts)
      .values(values)
      .onConflictDoUpdate({
        target: socialPosts.url,
        set: { ...values, updatedAt: new Date() },
      })
      .returning()
    return toRecord(row!)
  }

  const [row] = await db
    .update(socialPosts)
    .set({
      authorName: written('authorName'),
      handle: written('handle'),
      text: written('text'),
      postedAt: written('postedAt'),
      provenance,
      status: 'manual',
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(socialPosts.url, url))
    .returning()
  return toRecord(row!)
}

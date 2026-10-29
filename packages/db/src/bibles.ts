import {
  ChannelBibleReadSchema,
  ChannelNotFoundError,
  EXAMPLE_SLOT_IDS,
  isBibleComplete,
} from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { asc, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { bibleDrafts, channelBibles, channels } from './schema'
import type { BibleVersionRow } from './schema'

/**
 * A channel's bible as append-only versions (bible design, section 4.5).
 *
 * Nothing here updates or deletes a version. A save adds the next one and
 * moves the channel's current pointer; a project keeps the version it
 * started with, so editing the bible never changes a film midway.
 */

/** The transaction handle a caller already holds, for writes that must share it. */
export type BibleTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Append the channel's next version and point the channel at it. The caller
 * owns the transaction: `createChannel` and `ensureFirstChannel` write the
 * channel row and its first version in one.
 *
 * Locking the channel row first serialises two saves of the same channel, so
 * the version numbers have no gaps and neither save dies on the unique index.
 * `slotIds` is stamped from the registry as it stands now, so a later change
 * to the registry never makes this version look complete or incomplete.
 */
export async function appendBibleVersion(
  tx: BibleTransaction,
  channelId: string,
  bible: ChannelBible,
  note: string,
  options: { id?: string } = {},
): Promise<BibleVersionRow> {
  const [locked] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId))
    .for('update')
  if (!locked) throw new ChannelNotFoundError(channelId)

  const [latest] = await tx
    .select({ version: sql<number>`coalesce(max(${channelBibles.version}), 0)::int` })
    .from(channelBibles)
    .where(eq(channelBibles.channelId, channelId))

  const [row] = await tx
    .insert(channelBibles)
    .values({
      ...(options.id === undefined ? {} : { id: options.id }),
      channelId,
      version: (latest?.version ?? 0) + 1,
      bible,
      slotIds: [...EXAMPLE_SLOT_IDS],
      complete: isBibleComplete(bible),
      note,
    })
    .returning()

  await tx
    .update(channels)
    .set({ currentBibleId: row!.id, updatedAt: new Date() })
    .where(eq(channels.id, channelId))

  return row!
}

/** Save a new version of the channel's bible and make it the current one. */
export async function saveBibleVersion(
  db: Database,
  channelId: string,
  bible: ChannelBible,
  note: string,
): Promise<BibleVersionRow> {
  return db.transaction((tx) => appendBibleVersion(tx, channelId, bible, note))
}

/**
 * A stored version with its bible parsed, so a version saved before a key was
 * added (stage A stored eleven) comes back with the schema's defaults, as
 * `toChannel` already gives the project freeze. The read schema strips a key
 * the bible no longer has, so a retired one never fails the read.
 */
const parsed = (row: BibleVersionRow): BibleVersionRow => ({
  ...row,
  bible: ChannelBibleReadSchema.parse(row.bible),
})

/** The version the channel's current pointer names. A channel without one is a broken row. */
export async function currentBible(db: Database, channelId: string): Promise<BibleVersionRow> {
  const [row] = await db
    .select({ version: channelBibles })
    .from(channels)
    .innerJoin(channelBibles, eq(channelBibles.id, channels.currentBibleId))
    .where(eq(channels.id, channelId))
    .limit(1)
  if (row) return parsed(row.version)

  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
  if (!channel) throw new ChannelNotFoundError(channelId)
  throw new Error(`channel ${channelId} has no current bible version`)
}

/** Every version of the channel's bible, oldest first. */
export async function listBibleVersions(
  db: Database,
  channelId: string,
): Promise<BibleVersionRow[]> {
  const rows = await db
    .select()
    .from(channelBibles)
    .where(eq(channelBibles.channelId, channelId))
    .orderBy(asc(channelBibles.version))
  return rows.map(parsed)
}

export async function bibleVersionById(db: Database, id: string): Promise<BibleVersionRow> {
  const [row] = await db.select().from(channelBibles).where(eq(channelBibles.id, id)).limit(1)
  if (!row) throw new Error(`bible version ${id} not found`)
  return parsed(row)
}

/** The channel has a working draft, and a restore would leave it pointing at a stale base. */
export class BibleDraftExistsError extends Error {
  constructor(channelId: string) {
    super(`channel ${channelId} has an open bible draft; save or discard it first`)
    this.name = 'BibleDraftExistsError'
  }
}

/**
 * Append a copy of an earlier version as the channel's next one (nothing is
 * rewritten; the history keeps both). Refuses another channel's version, and
 * refuses while a draft is open: the draft was based on the version now
 * current, and a restore under it would make its save overwrite the restore.
 */
export async function restoreBibleVersion(
  db: Database,
  channelId: string,
  versionId: string,
): Promise<BibleVersionRow> {
  return db.transaction(async (tx) => {
    const [version] = await tx
      .select()
      .from(channelBibles)
      .where(eq(channelBibles.id, versionId))
      .limit(1)
    if (!version || version.channelId !== channelId) {
      throw new Error('bible version belongs to another channel')
    }
    const [draft] = await tx
      .select({ channelId: bibleDrafts.channelId })
      .from(bibleDrafts)
      .where(eq(bibleDrafts.channelId, channelId))
      .limit(1)
    if (draft) throw new BibleDraftExistsError(channelId)
    return appendBibleVersion(
      tx,
      channelId,
      ChannelBibleReadSchema.parse(version.bible),
      `Restored version ${version.version}`,
    )
  })
}

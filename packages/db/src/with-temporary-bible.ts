import type { ChannelBible } from '@boom-busters/schemas'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { currentBible, saveBibleVersion } from './bibles'
import type { Database } from './client'
import { bibleDrafts, channelBibles, channels, projects } from './schema'

/**
 * Run `fn` with the channel's current bible swapped for `bible`, then put the
 * channel back exactly as it was. For tests only: bible versions are
 * append-only, so a test that saves one would otherwise leave the channel on
 * it, plus an extra version, for every suite that runs after.
 *
 * Afterwards, whatever `fn` saved is gone: projects `fn` re-pointed are moved
 * back (and any still on a removed version go to the original), the channel's
 * pointer is the original again, and the channel's versions above the
 * original are deleted, so the numbering stays contiguous.
 */
export async function withTemporaryBible<T>(
  db: Database,
  channelId: string,
  bible: ChannelBible,
  fn: () => Promise<T>,
  note = 'Temporary bible for a test',
): Promise<T> {
  const original = await currentBible(db, channelId)
  const before = await db
    .select({ id: projects.id, bibleId: projects.bibleId })
    .from(projects)
    .where(eq(projects.channelId, channelId))
  await saveBibleVersion(db, channelId, bible, note)
  try {
    return await fn()
  } finally {
    await db.transaction(async (tx) => {
      const removed = (
        await tx
          .select({ id: channelBibles.id })
          .from(channelBibles)
          .where(
            and(
              eq(channelBibles.channelId, channelId),
              gt(channelBibles.version, original.version),
            ),
          )
      ).map((row) => row.id)

      for (const project of before) {
        await tx
          .update(projects)
          .set({ bibleId: project.bibleId })
          .where(eq(projects.id, project.id))
      }
      if (removed.length > 0) {
        await tx
          .update(projects)
          .set({ bibleId: original.id })
          .where(inArray(projects.bibleId, removed))
        await tx
          .update(bibleDrafts)
          .set({ baseBibleId: original.id })
          .where(inArray(bibleDrafts.baseBibleId, removed))
      }
      await tx
        .update(channels)
        .set({ currentBibleId: original.id })
        .where(eq(channels.id, channelId))
      if (removed.length > 0)
        await tx.delete(channelBibles).where(inArray(channelBibles.id, removed))
    })
  }
}

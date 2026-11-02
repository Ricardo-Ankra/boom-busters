import {
  BibleDraftSchema,
  ChannelBibleReadSchema,
  ChannelBibleSchema,
  bibleSaveBlockers,
  jobIsRunning,
} from '@boom-busters/schemas'
import type { BibleDraft } from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import type { Database } from './client'
import { appendBibleVersion, currentBible, lockChannelBible } from './bibles'
import type { BibleTransaction } from './bibles'
import { bibleDrafts } from './schema'
import type { BibleDraftRow, BibleVersionRow } from './schema'

/**
 * A channel's working bible draft. Every write locks the row first, so two
 * writers (an owner's edit and a drafting run) never overwrite each other.
 */

/** A job is running on the draft, so an owner's action would race it. */
export class BibleDraftBusyError extends Error {
  constructor(channelId: string) {
    super(`the bible draft for channel ${channelId} is being drafted; wait for it to finish`)
    this.name = 'BibleDraftBusyError'
  }
}

/** The channel's bible moved on (a restore or another save) after this draft was opened. */
export class BibleDraftStaleError extends Error {
  constructor() {
    super(
      'The bible changed since this draft was opened (a version was restored or saved). Discard this draft and redraft it from the current version.',
    )
    this.name = 'BibleDraftStaleError'
  }
}

/** The draft cannot become a version yet; `blockers` says why, in the owner's words. */
export class BibleDraftBlockedError extends Error {
  readonly blockers: string[]
  constructor(blockers: string[]) {
    super(`the bible draft cannot be saved: ${blockers.join('; ')}`)
    this.name = 'BibleDraftBlockedError'
    this.blockers = blockers
  }
}

/** The stored row as the draft the app works with; a retired bible key is stripped on read. */
function toDraft(row: BibleDraftRow): BibleDraft {
  return BibleDraftSchema.parse({
    ...row,
    bible: ChannelBibleReadSchema.parse(row.bible),
    updatedAt: row.updatedAt.toISOString(),
  })
}

/** Lock the channel's draft row for the rest of the transaction; null when there is none. */
async function lockDraft(tx: BibleTransaction, channelId: string): Promise<BibleDraft | null> {
  const [row] = await tx
    .select()
    .from(bibleDrafts)
    .where(eq(bibleDrafts.channelId, channelId))
    .for('update')
  return row ? toDraft(row) : null
}

export async function getBibleDraft(db: Database, channelId: string): Promise<BibleDraft | null> {
  const [row] = await db
    .select()
    .from(bibleDrafts)
    .where(eq(bibleDrafts.channelId, channelId))
    .limit(1)
  return row ? toDraft(row) : null
}

/**
 * The channel's draft, created from its current version with every section
 * approved when there is none. Two openers at once end with one draft.
 */
export async function openBibleDraft(db: Database, channelId: string): Promise<BibleDraft> {
  const existing = await getBibleDraft(db, channelId)
  if (existing) return existing

  const current = await currentBible(db, channelId)
  await db
    .insert(bibleDrafts)
    .values({
      channelId,
      baseBibleId: current.id,
      bible: current.bible,
      statuses: {
        identity: 'approved',
        voice: 'approved',
        look: 'approved',
        examples: 'approved',
        hooks: 'approved',
        search: 'approved',
        publishing: 'approved',
      },
      tooClose: {},
      errors: {},
      inputs: null,
      research: null,
      job: null,
    })
    .onConflictDoNothing()
  const draft = await getBibleDraft(db, channelId)
  if (!draft) throw new Error(`bible draft for channel ${channelId} could not be opened`)
  return draft
}

/**
 * Change the draft under a row lock: read it inside the transaction, apply
 * `change`, validate the result and write it. An owner's action throws
 * `BibleDraftBusyError` while a job runs; only a drafting run passes
 * `allowWhileRunning`, because it is that job.
 */
export async function writeBibleDraft(
  db: Database,
  channelId: string,
  change: (draft: BibleDraft) => BibleDraft,
  options: { allowWhileRunning?: boolean } = {},
): Promise<BibleDraft> {
  return db.transaction(async (tx) => {
    const draft = await lockDraft(tx, channelId)
    if (!draft) throw new Error(`channel ${channelId} has no draft to write`)
    if (!options.allowWhileRunning && draft.job && jobIsRunning(draft.job)) {
      throw new BibleDraftBusyError(channelId)
    }
    const next = BibleDraftSchema.parse(change(draft))
    const [row] = await tx
      .update(bibleDrafts)
      .set({
        baseBibleId: next.baseBibleId,
        bible: next.bible,
        statuses: next.statuses,
        tooClose: next.tooClose,
        errors: next.errors,
        inputs: next.inputs,
        research: next.research,
        job: next.job,
        updatedAt: new Date(),
      })
      .where(eq(bibleDrafts.channelId, channelId))
      .returning()
    return toDraft(row!)
  })
}

/** Throw the draft away. Refused while a job runs, so a job never writes to a deleted row. */
export async function discardBibleDraft(db: Database, channelId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const draft = await lockDraft(tx, channelId)
    if (!draft) return
    if (draft.job && jobIsRunning(draft.job)) throw new BibleDraftBusyError(channelId)
    await tx.delete(bibleDrafts).where(eq(bibleDrafts.channelId, channelId))
  })
}

/**
 * Turn the draft into the channel's next version and delete it, in one
 * transaction. Blocked by a section still drafted, a flagged line or a limit
 * overrun; refused while a job runs.
 */
export async function saveBibleDraft(
  db: Database,
  channelId: string,
  note: string,
): Promise<BibleVersionRow> {
  return db.transaction(async (tx) => {
    const channel = await lockChannelBible(tx, channelId)
    const draft = await lockDraft(tx, channelId)
    if (!draft) throw new Error(`channel ${channelId} has no draft to save`)
    if (draft.baseBibleId !== channel.currentBibleId) throw new BibleDraftStaleError()
    if (draft.job && jobIsRunning(draft.job)) throw new BibleDraftBusyError(channelId)
    const blockers = bibleSaveBlockers(draft)
    if (blockers.length > 0) throw new BibleDraftBlockedError(blockers)
    const bible = ChannelBibleSchema.parse(draft.bible)
    const version = await appendBibleVersion(tx, channelId, bible, note)
    await tx.delete(bibleDrafts).where(eq(bibleDrafts.channelId, channelId))
    return version
  })
}

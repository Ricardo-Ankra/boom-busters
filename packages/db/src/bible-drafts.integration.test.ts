import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BibleDraftBlockedError,
  BibleDraftBusyError,
  discardBibleDraft,
  getBibleDraft,
  openBibleDraft,
  saveBibleDraft,
  writeBibleDraft,
} from './bible-drafts'
import {
  BibleDraftExistsError,
  bibleVersionById,
  currentBible,
  restoreBibleVersion,
  saveBibleVersion,
} from './bibles'
import { createCase } from './cases'
import { createChannel } from './channels'
import { createDb } from './client'
import { createProjectFromCase, moveProjectBible } from './projects'
import {
  bibleDrafts,
  cases,
  channelBibles,
  channels,
  projects,
  workspace,
  youtubeConnections,
} from './schema'
import { requireTestDatabase } from './test-database'

/** Bible drafts, restore and moving a project's bible against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function channelInput(slug: string) {
  return {
    name: `Channel ${slug}`,
    handle: null,
    slug,
    settings: DEFAULT_SETTINGS,
    bible: FIRST_CHANNEL_BIBLE,
  }
}

const runningJob = () => ({
  kind: 'draft' as const,
  state: 'running' as const,
  current: null,
  error: null,
  startedAt: new Date().toISOString(),
})

suite('bible drafts', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 4 })
  let channelId = ''

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${bibleDrafts}, ${channels}, ${channelBibles}, ${workspace}, ${youtubeConnections}, ${projects}, ${cases} restart identity cascade`,
    )
    channelId = (await createChannel(db, channelInput('alpha'))).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('opens a draft from the current version with every section approved', async () => {
    expect(await getBibleDraft(db, channelId)).toBeNull()
    const current = await currentBible(db, channelId)
    const draft = await openBibleDraft(db, channelId)
    expect(draft.baseBibleId).toBe(current.id)
    expect(draft.bible).toEqual(current.bible)
    expect(Object.values(draft.statuses)).toEqual(Array(7).fill('approved'))
    expect(draft.job).toBeNull()
    // A second open returns the same draft rather than a new one.
    expect(await openBibleDraft(db, channelId)).toEqual(draft)
  })

  it('refuses to save a drafted section, then saves once it is approved', async () => {
    await openBibleDraft(db, channelId)
    await writeBibleDraft(db, channelId, (d) => ({
      ...d,
      statuses: { ...d.statuses, voice: 'drafted' },
    }))
    const v1 = await currentBible(db, channelId)

    const blocked = await saveBibleDraft(db, channelId, 'Drafted').catch((e: unknown) => e)
    expect(blocked).toBeInstanceOf(BibleDraftBlockedError)
    expect((blocked as BibleDraftBlockedError).blockers).toEqual(['Voice is drafted, not approved'])

    await writeBibleDraft(db, channelId, (d) => ({
      ...d,
      statuses: { ...d.statuses, voice: 'approved' },
    }))
    const saved = await saveBibleDraft(db, channelId, 'Drafted')
    expect(saved).toMatchObject({ version: 2, note: 'Drafted' })
    expect((await currentBible(db, channelId)).id).toBe(saved.id)
    expect(await getBibleDraft(db, channelId)).toBeNull()
    expect(await bibleVersionById(db, v1.id)).toEqual(v1)
  })

  it('refuses a save, a write and a discard while a job is running, unless allowed', async () => {
    await openBibleDraft(db, channelId)
    await writeBibleDraft(db, channelId, (d) => ({ ...d, job: runningJob() }), {
      allowWhileRunning: true,
    })
    await expect(saveBibleDraft(db, channelId, 'x')).rejects.toBeInstanceOf(BibleDraftBusyError)
    await expect(writeBibleDraft(db, channelId, (d) => d)).rejects.toBeInstanceOf(
      BibleDraftBusyError,
    )
    await expect(discardBibleDraft(db, channelId)).rejects.toBeInstanceOf(BibleDraftBusyError)
    expect(await getBibleDraft(db, channelId)).not.toBeNull()

    const done = await writeBibleDraft(
      db,
      channelId,
      (d) => ({ ...d, job: { ...runningJob(), state: 'done' } }),
      { allowWhileRunning: true },
    )
    expect(done.job?.state).toBe('done')
    await discardBibleDraft(db, channelId)
    expect(await getBibleDraft(db, channelId)).toBeNull()
  })

  it('keeps both of two concurrent writes', async () => {
    await openBibleDraft(db, channelId)
    await Promise.all([
      writeBibleDraft(db, channelId, (d) => ({ ...d, errors: { ...d.errors, a: 'one' } })),
      writeBibleDraft(db, channelId, (d) => ({ ...d, errors: { ...d.errors, b: 'two' } })),
    ])
    expect((await getBibleDraft(db, channelId))?.errors).toEqual({ a: 'one', b: 'two' })
  })

  it('writeBibleDraft on a channel with no draft throws', async () => {
    await expect(writeBibleDraft(db, channelId, (d) => d)).rejects.toThrow(/no draft/)
  })

  it('restores a version as a new one, and refuses another channel or an open draft', async () => {
    const v1 = await currentBible(db, channelId)
    await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'ships' }, 'Edit')
    const restored = await restoreBibleVersion(db, channelId, v1.id)
    expect(restored).toMatchObject({ version: 3, note: 'Restored version 1' })
    expect(restored.bible).toEqual(v1.bible)
    expect((await currentBible(db, channelId)).id).toBe(restored.id)

    const other = await createChannel(db, { ...channelInput('beta'), bible: EMPTY_BIBLE })
    const otherVersion = await currentBible(db, other.id)
    await expect(restoreBibleVersion(db, channelId, otherVersion.id)).rejects.toThrow(
      /another channel/,
    )

    await openBibleDraft(db, channelId)
    await expect(restoreBibleVersion(db, channelId, v1.id)).rejects.toBeInstanceOf(
      BibleDraftExistsError,
    )
  })

  it('moves a project to a newer version of its channel, never another channel', async () => {
    const kase = await createCase(db, { channelId, title: 'T', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'T' })
    const v1 = await currentBible(db, channelId)
    expect(project.bibleId).toBe(v1.id)
    const v2 = await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'x' }, 'e')

    await moveProjectBible(db, project.id, v2.id)
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id))
    expect(row?.bibleId).toBe(v2.id)

    const other = await createChannel(db, channelInput('beta'))
    const otherVersion = await currentBible(db, other.id)
    await expect(moveProjectBible(db, project.id, otherVersion.id)).rejects.toThrow(
      /another channel/,
    )
  })

  it('reads a stored version that carries a key the schema no longer has', async () => {
    const v1 = await currentBible(db, channelId)
    await sql`update channel_bibles set bible = bible || '{"retiredKey": "x"}'::jsonb where id = ${v1.id}`
    const read = await currentBible(db, channelId)
    expect(read.bible).toEqual(v1.bible)
    expect(await bibleVersionById(db, v1.id)).toEqual(v1)
  })
})

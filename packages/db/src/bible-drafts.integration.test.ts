import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  BibleDraftBlockedError,
  BibleDraftBusyError,
  BibleDraftStaleError,
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
  lockChannelBible,
  restoreBibleVersion,
  saveBibleVersion,
} from './bibles'
import { createCase } from './cases'
import { channelForProject, createChannel, getChannel } from './channels'
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

  it('refuses to save a draft whose base is no longer the current version', async () => {
    const v1 = await currentBible(db, channelId)
    await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'ships' }, 'Edit')
    const v2 = await currentBible(db, channelId)
    // A draft opened as the restore lands: it was based on the version before it.
    await openBibleDraft(db, channelId)
    await db
      .update(bibleDrafts)
      .set({ baseBibleId: v1.id })
      .where(eq(bibleDrafts.channelId, channelId))
    const refused = await saveBibleDraft(db, channelId, 'x').catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(BibleDraftStaleError)
    expect((refused as Error).message).toMatch(/discard this draft and redraft/i)
    // Nothing was written: the current version is still v2 and the draft is still there.
    expect((await currentBible(db, channelId)).id).toBe(v2.id)
    expect(await getBibleDraft(db, channelId)).not.toBeNull()
  })

  it('a restore waits for the channel lock another writer holds', async () => {
    const v1 = await currentBible(db, channelId)
    await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'ships' }, 'Edit')

    /** Poll (bounded) until `check` is true; fail with a clear message rather than hang. */
    const until = async (what: string, check: () => Promise<boolean>) => {
      const deadline = Date.now() + 5000
      while (!(await check())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }

    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    let locked: (pid: number) => void = () => {}
    const lockTaken = new Promise<number>((resolve) => (locked = resolve))
    const holder = db.transaction(async (tx) => {
      await lockChannelBible(tx, channelId)
      const [backend] = Array.from(await tx.execute(dsql`select pg_backend_pid() as pid`)) as {
        pid: number
      }[]
      locked(backend!.pid)
      await held
    })
    let restore: Promise<unknown> = Promise.resolve()
    let restored = false
    type Outcome = { ok: true; row: { version: number } } | { ok: false; error: unknown }
    const outcome: { value: Outcome } = {
      value: { ok: false, error: new Error('the restore never started') },
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // The holder has the lock (not a guess at a delay); bounded, so a stuck holder fails.
      const holderPid = await Promise.race([
        lockTaken,
        holder.then(() => {
          throw new Error('the lock holder ended before taking the lock')
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out waiting for the holder to take the channel lock')),
            5000,
          )
        }),
      ])
      restore = restoreBibleVersion(db, channelId, v1.id).then(
        (row) => {
          restored = true
          outcome.value = { ok: true, row }
        },
        (error: unknown) => {
          outcome.value = { ok: false, error }
        },
      )
      // Some other backend in this database is blocked by the holder's own backend.
      await until('the restore to wait on the channel lock', async () => {
        const rows = await db.execute(
          dsql`select pid from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and ${holderPid}::int = any(pg_blocking_pids(pid))`,
        )
        return Array.from(rows).length > 0
      })
      expect(restored).toBe(false)
    } finally {
      clearTimeout(timer)
      release()
      await holder.catch(() => {})
      await restore.catch(() => {})
    }
    if (!outcome.value.ok) throw outcome.value.error
    expect(restored).toBe(true)
    expect(outcome.value.row.version).toBe(3)
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

  it('reads a channel and a project freeze whose version carries a retired key', async () => {
    const v1 = await currentBible(db, channelId)
    const kase = await createCase(db, { channelId, title: 'T', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'T' })
    await sql`update channel_bibles set bible = bible || '{"retiredKey": "x"}'::jsonb where id = ${v1.id}`
    const channel = await getChannel(db, channelId)
    expect(channel.bible).toEqual(v1.bible)
    expect(channel.bible).not.toHaveProperty('retiredKey')
    const frozen = await channelForProject(db, project.id)
    expect(frozen.bible).toEqual(v1.bible)
  })
})

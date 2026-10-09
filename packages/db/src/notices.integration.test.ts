import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import {
  addNotice,
  dismissNotice,
  listCaseNotices,
  listProjectNotices,
  replaceNotices,
} from './notices'
import { createProjectFromCase, deleteProjectsExcept } from './projects'
import { requireTestDatabase } from './test-database'

/** Notices (decision 293) against the test container. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('notices', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await deleteProjectsExcept(db, [])
    await truncateCases(db)
    await sql`DELETE FROM notices`
    const kase = await createCase(db, { title: 'Stability AI', category: 'collapse' })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Stability AI' })).id
  })

  const direction = () => ({ projectId, subject: 'direction' as const, subjectId: null })

  it('adds a notice and lists it with the project, newest first', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped: first.' })
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped: second.' })
    const listed = await listProjectNotices(db, projectId)
    expect(listed.map((notice) => notice.message)).toEqual([
      'The redraft stopped: second.',
      'The redraft stopped: first.',
    ])
    expect(listed[0]).toMatchObject({ subject: 'direction', subjectId: null, kind: 'stopped' })
  })

  it("retires the subject's open notices when the next answer has none", async () => {
    await replaceNotices(db, direction(), [
      { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' },
    ])
    await replaceNotices(db, direction(), [])
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('replaces only its own subject, and only the item named', async () => {
    const slotA = { projectId, subject: 'slot' as const, subjectId: 'slot-a' }
    const slotB = { projectId, subject: 'slot' as const, subjectId: 'slot-b' }
    await addNotice(db, slotA, { kind: 'stopped', message: 'The re-brief stopped: A.' })
    await addNotice(db, slotB, { kind: 'stopped', message: 'The re-brief stopped: B.' })
    await addNotice(db, direction(), { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' })
    await replaceNotices(db, slotA, [{ kind: 'trimmed', message: 'Trimmed to fit: the intent.' }])
    const messages = (await listProjectNotices(db, projectId)).map((notice) => notice.message)
    expect(messages.sort()).toEqual([
      'The re-brief stopped: B.',
      'Trimmed to fit: era rule 1.',
      'Trimmed to fit: the intent.',
    ])
  })

  it('cuts a message to 1,000 characters before storing it', async () => {
    await addNotice(db, direction(), { kind: 'trimmed', message: 'x'.repeat(1500) })
    const [notice] = await listProjectNotices(db, projectId)
    expect(notice?.message.length).toBe(1000)
  })

  it('dismisses a notice, and dismisses twice without complaint', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped.' })
    const [notice] = await listProjectNotices(db, projectId)
    await dismissNotice(db, notice!.id)
    await dismissNotice(db, notice!.id)
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('lists a notice for a slot that does not exist, for the board to ignore', async () => {
    await addNotice(
      db,
      { projectId, subject: 'slot', subjectId: 'gone' },
      {
        kind: 'stopped',
        message: 'The retype stopped.',
      },
    )
    expect(await listProjectNotices(db, projectId)).toHaveLength(1)
  })

  it('keeps Case Library notices apart from projects, by case', async () => {
    const one = await createCase(db, { title: 'Theranos', category: 'con' })
    const two = await createCase(db, { title: 'FTX', category: 'con' })
    await addNotice(
      db,
      { projectId: null, subject: 'case', subjectId: one.id },
      {
        kind: 'trimmed',
        message: 'Trimmed to fit: the angle.',
      },
    )
    await addNotice(
      db,
      { projectId: null, subject: 'case', subjectId: two.id },
      {
        kind: 'trimmed',
        message: 'Trimmed to fit: the demand notes.',
      },
    )
    expect((await listCaseNotices(db, [one.id])).map((notice) => notice.message)).toEqual([
      'Trimmed to fit: the angle.',
    ])
    expect(await listCaseNotices(db, [])).toEqual([])
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('goes with its project', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped.' })
    await deleteProjectsExcept(db, [])
    const [row] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM notices`
    expect(row?.count).toBe('0')
  })
})

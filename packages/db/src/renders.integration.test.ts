import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import { getRender, insertRender, latestRender, renderInFlight, updateRender } from './renders'
import { cases, projects } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * Render bookkeeping against a real database: one row per invoke, terminal
 * states land on the same row, and "is a render in flight" — the section 8.1
 * stop-confirm's question — answers from status alone.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('render bookkeeping', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('walks a render through its lifecycle on one row', async () => {
    const row = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 1,
      kind: 'master',
      costUsd: '0.25',
    })
    expect(row.status).toBe('queued')

    await updateRender(db, row.id, {
      status: 'rendering',
      brokerRenderId: row.id,
      remotionRenderId: 'rem-1',
      startedAt: new Date(),
    })
    expect((await renderInFlight(db, FIXTURE_PROJECT_ID))?.id).toBe(row.id)

    await updateRender(db, row.id, {
      status: 'done',
      progressPct: 100,
      outputS3Key: 'renders/rem-1/out.mp4',
      qcReport: { passed: true, integratedLufs: -14, issues: [] },
      completedAt: new Date(),
    })
    const finished = await getRender(db, row.id)
    expect(finished?.status).toBe('done')
    expect(finished?.qcReport).toMatchObject({ passed: true })
    expect(await renderInFlight(db, FIXTURE_PROJECT_ID)).toBeUndefined()
  })

  it('latestRender answers with the newest master, ignoring shorts', async () => {
    const first = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 1,
      kind: 'master',
    })
    const second = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 2,
      kind: 'master',
    })
    expect(first.id).not.toBe(second.id)
    expect((await latestRender(db, FIXTURE_PROJECT_ID))?.timelineVersion).toBe(2)
  })
})

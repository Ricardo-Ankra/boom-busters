import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import { globalPulse, projectPulse } from './pulse'
import { cases, projects, runs } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The pulse against a real database: it must move when the page-visible
 * state moves (project row, run mirror) and hold still otherwise — its
 * whole purpose is to let LiveRefresh SKIP re-reading the page.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('pulse', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('holds still while nothing changes', async () => {
    const first = await projectPulse(db, FIXTURE_PROJECT_ID)
    expect(first).not.toBe('')
    expect(await projectPulse(db, FIXTURE_PROJECT_ID)).toBe(first)
  })

  it('moves when the project row changes', async () => {
    const before = await projectPulse(db, FIXTURE_PROJECT_ID)
    // updatedAt's $onUpdate stamps a fresh clock reading on any update.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await db
      .update(projects)
      .set({ stageStatus: 'running' })
      .where(dsql`${projects.id} = ${FIXTURE_PROJECT_ID}`)
    const after = await projectPulse(db, FIXTURE_PROJECT_ID)
    expect(after).not.toBe(before)
  })

  it('moves when the run mirror changes', async () => {
    const before = await projectPulse(db, FIXTURE_PROJECT_ID)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await db.insert(runs).values({
      inngestRunId: 'run-pulse-1',
      functionName: 'assembly-runner',
      projectId: FIXTURE_PROJECT_ID,
      status: 'running',
    })
    const after = await projectPulse(db, FIXTURE_PROJECT_ID)
    expect(after).not.toBe(before)
  })

  it('answers empty for an unknown project rather than throwing', async () => {
    expect(await projectPulse(db, '01HQ00000000000000000NOPE1')).toBe('')
  })

  it('the global pulse covers every project', async () => {
    const before = await globalPulse(db)
    expect(before).not.toBe('')
    await new Promise((resolve) => setTimeout(resolve, 5))
    await db
      .update(projects)
      .set({ stageStatus: 'failed' })
      .where(dsql`${projects.id} = ${FIXTURE_PROJECT_ID}`)
    expect(await globalPulse(db)).not.toBe(before)
  })
})

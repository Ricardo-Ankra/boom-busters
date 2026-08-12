import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, getCase, truncateCases } from './cases'
import { createDb } from './client'
import { saveDossier } from './dossiers'
import {
  createProjectFromCase,
  deleteProject,
  getProject,
  projectDeletionSummary,
} from './projects'
import { createScriptVersion, saveChapter } from './scripts'
import { ensureRun, recordRunEvent } from './runs'
import { costLedger } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * Deleting a project (M3.3).
 *
 * The behaviour worth pinning down is not that rows disappear — the foreign
 * keys guarantee that — but the two exceptions to it: the spend survives,
 * because the money was really spent, and the case survives, because a case is
 * a story worth telling and abandoning one attempt at it does not retract that.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('deleting a project', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let caseId = ''
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    await db.delete(costLedger)

    const source = await createCase(db, { title: 'Enron', category: 'collapse' })
    caseId = source.id
    const project = await createProjectFromCase(db, { caseId, title: 'Enron' })
    projectId = project.id

    await saveDossier(db, {
      projectId,
      contentMd: '# Enron',
      claims: [
        {
          text: 'Mark-to-market accounting was approved by the SEC in 1992.',
          sourceUrl: 'https://example.com/sec',
          sourceType: 'regulator',
          confidence: 'sourced',
        },
        {
          text: 'Special purpose entities concealed roughly $30bn of debt.',
          sourceUrl: 'https://example.com/report',
          sourceType: 'other',
          confidence: 'single_source',
        },
      ],
    })

    const script = await createScriptVersion(db, projectId)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The rise',
      contentMd: 'Chapter one.',
      estRuntimeSec: 90,
    })

    const runId = await ensureRun(db, {
      inngestRunId: '01TESTDELETE00000000000001',
      functionName: 'dossier-runner',
      projectId,
      stage: 'dossier',
    })
    await recordRunEvent(db, { runId, kind: 'run.started' })

    await db.insert(costLedger).values({
      provider: 'anthropic',
      operation: 'research',
      projectId,
      estimatedUsd: '1.5000',
      actualUsd: '2.3400',
    })
  })

  describe('projectDeletionSummary', () => {
    it('counts what would be destroyed, so the confirm can name it', () => {
      // "This cannot be undone" is a warning nobody can weigh.
      return expect(projectDeletionSummary(db, projectId)).resolves.toMatchObject({
        claims: 2,
        chapters: 1,
        scripts: 1,
        runs: 1,
      })
    })

    it('totals the spend across all time, not just this month', async () => {
      const summary = await projectDeletionSummary(db, projectId)
      // The settled figure, not the reservation it started as.
      expect(summary.spendUsd).toBeCloseTo(2.34, 4)
    })

    it('reports nothing published, so deletion is allowed', async () => {
      expect((await projectDeletionSummary(db, projectId)).publishedCount).toBe(0)
    })

    it('answers for a project that does not exist without throwing', async () => {
      expect(await projectDeletionSummary(db, '01NOSUCHPROJECT00000000001')).toMatchObject({
        claims: 0,
        publishedCount: 0,
      })
    })
  })

  describe('deleteProject', () => {
    it('removes the project and everything produced under it', async () => {
      expect(await deleteProject(db, projectId)).toBe(true)
      expect(await getProject(db, projectId)).toBeUndefined()

      const orphans = await sql`
        select
          (select count(*) from dossiers where project_id = ${projectId})::int as dossiers,
          (select count(*) from scripts  where project_id = ${projectId})::int as scripts,
          (select count(*) from runs     where project_id = ${projectId})::int as runs`
      expect(orphans[0]).toEqual({ dossiers: 0, scripts: 0, runs: 0 })
    })

    it('keeps the spend, attributed to no project', async () => {
      // A Costs screen that got cheaper because a project was tidied away
      // would be a Costs screen nobody could use to answer "what has this cost
      // me". The money was spent either way.
      await deleteProject(db, projectId)

      const rows = await db.select().from(costLedger)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.projectId).toBeNull()
      expect(rows[0]?.actualUsd).toBe('2.3400')
    })

    it('keeps the case it came from', async () => {
      await deleteProject(db, projectId)

      const source = await getCase(db, caseId)
      expect(source).toBeDefined()
      // And the case now reads as having nothing produced from it, which is
      // true and makes it startable again.
      expect(source?.projectCount).toBe(0)
    })

    it('reports honestly when there was nothing to delete', async () => {
      expect(await deleteProject(db, '01NOSUCHPROJECT00000000001')).toBe(false)
    })
  })
})

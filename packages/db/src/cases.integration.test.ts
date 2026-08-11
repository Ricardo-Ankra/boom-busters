import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  createCase,
  createSuggestedCases,
  deleteCase,
  existingCaseTitles,
  getCase,
  listCases,
  listProducibleCases,
  markCaseInProduction,
  setCaseStatus,
  truncateCases,
  updateCase,
} from './cases'
import { createProjectFromCase, deleteProjectsExcept, listProjects } from './projects'
import { requireTestDatabase } from './test-database'

/**
 * Gated on TEST_DATABASE_URL, not DATABASE_URL: these truncate the cases table,
 * which cascades to projects. They will not run against a deployment's data.
 */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('cases', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
  })

  it('creates a case as an idea by default', async () => {
    const row = await createCase(db, { title: 'Enron', category: 'collapse' })

    expect(row.status).toBe('idea')
    expect(row.priorityScore).toBe(0)
    expect(row.id).toHaveLength(26)
  })

  it('reports how many projects came from a case', async () => {
    const row = await createCase(db, { title: 'Enron', category: 'collapse' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Enron' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Enron, again' })

    expect((await getCase(db, row.id))?.projectCount).toBe(2)
  })

  it('clears projects that share a kept case', async () => {
    // `deleteCasesExcept` only reaches projects whose *case* is going. The E2E
    // suite seeds its extra projects against the fixture case precisely because
    // that case is kept — so without this they survived every reset and piled
    // up one run at a time.
    const row = await createCase(db, { title: 'Enron', category: 'collapse' })
    const keep = await createProjectFromCase(db, { caseId: row.id, title: 'The one to keep' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Left over from last run' })
    await createProjectFromCase(db, { caseId: row.id, title: 'And the run before that' })

    expect(await deleteProjectsExcept(db, [keep.id])).toBe(2)

    const remaining = await listProjects(db)
    expect(remaining.map((project) => project.title)).toEqual(['The one to keep'])
    // The case itself is untouched: this clears projects, not the library.
    expect(await getCase(db, row.id)).toBeDefined()
  })

  it('counts zero projects without dropping the case from the list', async () => {
    // A left join done wrong makes case rows vanish the moment they have no
    // projects, which is every case in a fresh library.
    await createCase(db, { title: 'Enron', category: 'collapse' })

    const [only] = await listCases(db)
    expect(only?.projectCount).toBe(0)
  })

  describe('sorting', () => {
    beforeEach(async () => {
      await createCase(db, { title: 'Beta', category: 'con', priorityScore: 50 })
      await createCase(db, { title: 'Alpha', category: 'collapse', priorityScore: 50 })
      await createCase(db, { title: 'Gamma', category: 'meltdown', priorityScore: 90 })
    })

    it('sorts by priority, breaking ties by title for a stable table', async () => {
      const titles = (await listCases(db, { sort: 'priority' })).map((c) => c.title)
      expect(titles).toEqual(['Gamma', 'Alpha', 'Beta'])
    })

    it('sorts by category', async () => {
      const categories = (await listCases(db, { sort: 'category' })).map((c) => c.category)
      expect(categories).toEqual(['collapse', 'con', 'meltdown'])
    })

    it('filters by status', async () => {
      const [first] = await listCases(db)
      await setCaseStatus(db, first!.id, 'published')

      const published = await listCases(db, { status: ['published'] })
      expect(published).toHaveLength(1)
      expect(published[0]?.title).toBe('Gamma')
    })
  })

  describe('createSuggestedCases', () => {
    it('skips a title already in the library', async () => {
      await createCase(db, { title: 'Enron', category: 'collapse' })

      const { created, skippedTitles } = await createSuggestedCases(db, [
        { title: 'Enron', category: 'collapse' },
        { title: 'Wirecard', category: 'con' },
      ])

      expect(created).toHaveLength(1)
      expect(skippedTitles).toEqual(['Enron'])
    })

    it('matches titles case- and whitespace-insensitively', async () => {
      await createCase(db, { title: 'Enron', category: 'collapse' })

      const { created } = await createSuggestedCases(db, [
        { title: '  enron  ', category: 'collapse' },
      ])

      expect(created).toHaveLength(0)
    })

    it('deduplicates within a single batch', async () => {
      // A model asked for ten cases will phrase the same one twice.
      const { created, skippedTitles } = await createSuggestedCases(db, [
        { title: 'Wirecard', category: 'con' },
        { title: 'wirecard', category: 'con' },
      ])

      expect(created).toHaveLength(1)
      expect(skippedTitles).toHaveLength(1)
    })

    it('does nothing at all for an empty batch', async () => {
      expect(await createSuggestedCases(db, [])).toEqual({ created: [], skippedTitles: [] })
    })
  })

  describe('deleteCase', () => {
    it('deletes a case nothing was produced from', async () => {
      const row = await createCase(db, { title: 'Enron', category: 'collapse' })

      expect(await deleteCase(db, row.id)).toBe(true)
      expect(await getCase(db, row.id)).toBeUndefined()
    })

    it('refuses to delete a case with projects behind it', async () => {
      const row = await createCase(db, { title: 'Enron', category: 'collapse' })
      await createProjectFromCase(db, { caseId: row.id, title: 'Enron' })

      // Deleting would orphan the record of why that project exists.
      expect(await deleteCase(db, row.id)).toBe(false)
      expect(await getCase(db, row.id)).toBeDefined()
    })
  })

  describe('markCaseInProduction', () => {
    it('moves a shortlisted case into production', async () => {
      const row = await createCase(db, {
        title: 'Enron',
        category: 'collapse',
        status: 'shortlisted',
      })

      await markCaseInProduction(db, row.id)

      expect((await getCase(db, row.id))?.status).toBe('in_production')
    })

    it('does not drag a published case backwards', async () => {
      // Starting a second project from a published case must not un-publish it.
      const row = await createCase(db, {
        title: 'Enron',
        category: 'collapse',
        status: 'published',
      })

      await markCaseInProduction(db, row.id)

      expect((await getCase(db, row.id))?.status).toBe('published')
    })
  })

  it('lists only shortlisted cases as producible', async () => {
    await createCase(db, { title: 'Idea', category: 'collapse' })
    await createCase(db, { title: 'Ready', category: 'con', status: 'shortlisted' })
    await createCase(db, { title: 'Done', category: 'con', status: 'published' })

    const producible = await listProducibleCases(db)
    expect(producible.map((c) => c.title)).toEqual(['Ready'])
  })

  it('lists existing titles alphabetically for the suggestion prompt', async () => {
    await createCase(db, { title: 'Zeta', category: 'con' })
    await createCase(db, { title: 'Alpha', category: 'con' })

    expect(await existingCaseTitles(db)).toEqual(['Alpha', 'Zeta'])
  })

  it('updates a case without touching what was not patched', async () => {
    const row = await createCase(db, {
      title: 'Enron',
      category: 'collapse',
      angle: 'original',
      priorityScore: 10,
    })

    await updateCase(db, row.id, { priorityScore: 80 })

    const updated = await getCase(db, row.id)
    expect(updated?.priorityScore).toBe(80)
    expect(updated?.angle).toBe('original')
    expect(updated?.title).toBe('Enron')
  })
})

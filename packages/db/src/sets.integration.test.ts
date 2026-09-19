import { ValidationError } from '@boom-busters/schemas'
import type { SetPlate } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { createProjectFromCase, deleteProjectsExcept } from './projects'
import {
  dismissProjectSet,
  getProjectSet,
  insertProjectSet,
  listProjectSets,
  seedSetsFromLocations,
  setSetPlates,
  updateProjectSet,
} from './sets'
import { requireTestDatabase } from './test-database'

/**
 * The set table (decision 264) against the test container: one name per
 * project, four plates at most, gone with the project.
 */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function plate(hash: string, view: SetPlate['view'] = 'other'): SetPlate {
  return {
    r2Key: `boom-busters/sets/p/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 900,
    view,
    origin: 'generated',
  }
}

suite('project sets', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await deleteProjectsExcept(db, [])
    await truncateCases(db)
    const kase = await createCase(db, { title: 'Wirecard', category: 'con' })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Wirecard' })).id
  })

  it('lists only the sets that are not dismissed, oldest first', async () => {
    const a = await insertProjectSet(db, {
      projectId,
      name: 'The trading floor',
      look: 'cold blue light',
    })
    const b = await insertProjectSet(db, { projectId, name: 'The boardroom' })
    const c = await insertProjectSet(db, { projectId, name: 'The lobby' })
    await dismissProjectSet(db, b.id)

    const sets = await listProjectSets(db, projectId)
    expect(sets.map((set) => set.name)).toEqual(['The trading floor', 'The lobby'])
    expect(sets[0]).toMatchObject({ id: a.id, look: 'cold blue light', plates: [] })
    expect(sets[1]?.id).toBe(c.id)
  })

  it('refuses a second set with the same name in one project', async () => {
    await insertProjectSet(db, { projectId, name: 'The trading floor' })
    await expect(insertProjectSet(db, { projectId, name: 'The trading floor' })).rejects.toThrow(
      /already exists/,
    )
  })

  it('allows the same set name in a different project', async () => {
    await insertProjectSet(db, { projectId, name: 'The trading floor' })
    const otherCase = await createCase(db, { title: 'Enron', category: 'collapse' })
    const otherProjectId = (
      await createProjectFromCase(db, { caseId: otherCase.id, title: 'Enron' })
    ).id

    const set = await insertProjectSet(db, { projectId: otherProjectId, name: 'The trading floor' })
    expect(set.name).toBe('The trading floor')
    expect((await listProjectSets(db, otherProjectId)).map((s) => s.id)).toEqual([set.id])
  })

  it('revives a dismissed set rather than refusing the name, with the new look and no plates', async () => {
    const original = await insertProjectSet(db, {
      projectId,
      name: 'The trading floor',
      look: 'cold blue light',
    })
    await setSetPlates(db, original.id, [plate('a')])
    await dismissProjectSet(db, original.id)

    const revived = await insertProjectSet(db, {
      projectId,
      name: 'The trading floor',
      look: 'warmer, brass fittings',
    })
    expect(revived.id).toBe(original.id)
    expect(revived).toMatchObject({ look: 'warmer, brass fittings', plates: [] })
    expect((await listProjectSets(db, projectId)).map((s) => s.name)).toEqual(['The trading floor'])
  })

  it('refuses a set with no name', async () => {
    await expect(insertProjectSet(db, { projectId, name: '  ' })).rejects.toThrow(ValidationError)
  })

  it('keeps at most four plates', async () => {
    const set = await insertProjectSet(db, { projectId, name: 'The trading floor' })
    const four = ['a', 'b', 'c', 'd'].map((h) => plate(h))
    expect((await setSetPlates(db, set.id, four)).plates).toHaveLength(4)
    await expect(setSetPlates(db, set.id, [...four, plate('e')])).rejects.toThrow(ValidationError)
  })

  it('updating a set that was dismissed throws', async () => {
    const set = await insertProjectSet(db, { projectId, name: 'The trading floor' })
    await dismissProjectSet(db, set.id)
    await expect(updateProjectSet(db, set.id, { look: 'x' })).rejects.toThrow(ValidationError)
  })

  it('dismissing empties the plates and hides the set from the list', async () => {
    const set = await insertProjectSet(db, { projectId, name: 'The trading floor' })
    await setSetPlates(db, set.id, [plate('a')])
    await dismissProjectSet(db, set.id)
    expect(await listProjectSets(db, projectId)).toEqual([])
    expect(await getProjectSet(db, set.id)).toBeNull()
  })

  it("seedSetsFromLocations inserts the book's locations and skips one already held", async () => {
    await insertProjectSet(db, { projectId, name: 'The boardroom', look: 'already here' })
    const locations = [
      { name: 'The trading floor', look: 'cold blue light, rows of monitors' },
      { name: 'The boardroom', look: 'a look the book would have written' },
    ]

    const added = await seedSetsFromLocations(db, projectId, locations)
    expect(added.map((set) => set.name)).toEqual(['The trading floor'])
    const sets = await listProjectSets(db, projectId)
    expect(sets.map((set) => set.name)).toEqual(['The boardroom', 'The trading floor'])
    expect(sets.find((set) => set.name === 'The boardroom')?.look).toBe('already here')
  })

  it('seedSetsFromLocations does not resurrect a dismissed set', async () => {
    const gone = await insertProjectSet(db, { projectId, name: 'The lobby', look: 'marble floor' })
    await dismissProjectSet(db, gone.id)

    const added = await seedSetsFromLocations(db, projectId, [
      { name: 'The lobby', look: 'a brand new look' },
    ])
    expect(added).toEqual([])
    expect(await listProjectSets(db, projectId)).toEqual([])
    expect(await getProjectSet(db, gone.id)).toBeNull()
  })
})

import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import { cases, projects, scripts } from './schema'
import { getShort, insertShort, latestShortsCandidates, listShorts, updateShort } from './shorts'
import { requireTestDatabase } from './test-database'

/**
 * Shorts bookkeeping against a real database: rows are per-Short being made,
 * renderId points at the render of the CURRENT configuration, and the
 * candidates come from the latest script version only.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'

suite('shorts bookkeeping', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('creates, lists in creation order, and edits a Short', async () => {
    const first = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'The audit that lied',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 1 },
    })
    expect(first.ending).toBe('cta')
    expect(first.relatedLinkChecked).toBe(false)

    await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'Nine days',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 2, toParagraph: 2 },
      ending: 'loop',
    })

    const listed = await listShorts(db, FIXTURE_PROJECT_ID)
    expect(listed.map((row) => row.title)).toEqual(['The audit that lied', 'Nine days'])
    expect(listed[1]?.ending).toBe('loop')

    await updateShort(db, first.id, {
      title: 'The audit',
      description: 'How EY missed €1.9bn.',
      relatedLinkChecked: true,
    })
    const edited = await getShort(db, first.id)
    expect(edited?.title).toBe('The audit')
    expect(edited?.description).toBe('How EY missed €1.9bn.')
    expect(edited?.relatedLinkChecked).toBe(true)
  })

  it('nulling renderId marks the configuration unrendered without losing the row', async () => {
    const short = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'x',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
    })
    await updateShort(db, short.id, { renderId: '01HQ00000000000000000000RD' })
    expect((await getShort(db, short.id))?.renderId).toBe('01HQ00000000000000000000RD')

    await updateShort(db, short.id, { renderId: null, ending: 'loop' })
    const toggled = await getShort(db, short.id)
    expect(toggled?.renderId).toBeNull()
    expect(toggled?.ending).toBe('loop')
  })

  it('latestShortsCandidates reads the newest script version only', async () => {
    const candidate = (n: number) => ({
      chapterIndex: 0,
      startSentence: `Start ${n}.`,
      endSentence: `End ${n}.`,
      hookRationale: 'A number that stops the thumb dead.',
    })
    await db.insert(scripts).values({
      projectId: FIXTURE_PROJECT_ID,
      version: 1,
      shortsCandidates: [candidate(1)],
    })
    await db.insert(scripts).values({
      projectId: FIXTURE_PROJECT_ID,
      version: 2,
      shortsCandidates: [candidate(2), candidate(3)],
    })

    const candidates = await latestShortsCandidates(db, FIXTURE_PROJECT_ID)
    expect(candidates.map((c) => c.startSentence)).toEqual(['Start 2.', 'Start 3.'])
  })

  it('a project with no script has no candidates, not an error', async () => {
    expect(await latestShortsCandidates(db, FIXTURE_PROJECT_ID)).toEqual([])
  })
})

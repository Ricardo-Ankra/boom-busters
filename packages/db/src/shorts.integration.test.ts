import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureFirstChannel } from './channels'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import { cases, projects, scripts } from './schema'
import {
  claimPointWork,
  getShort,
  insertShort,
  latestShortsCandidates,
  isAssembledShort,
  listShorts,
  settlePointWork,
  shortForPoint,
  updateShort,
} from './shorts'
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
    await ensureFirstChannel(db)
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

  it('a point Short round-trips its five point columns and is found by point id', async () => {
    const pointId = '01HQ0000000000000000000P01'
    const script = {
      title: 'The audit that lied',
      scriptVersion: 2,
      pointId,
      paragraphs: [
        { phase: 'hook' as const, text: 'Nobody checked the one number.', chapterIndex: 0 },
      ],
    }
    const voice = { scriptVersion: 2, paragraphs: [] }
    const plan = { shots: [], plannedFor: { scriptVersion: 2, voiceHash: 'abc' } }
    const fetches = { candidates: [], state: null }
    const short = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'The audit that lied',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
      kind: 'point',
      pointId,
      pointScript: script,
    })
    expect(short.kind).toBe('point')
    expect(short.pointId).toBe(pointId)
    expect(short.pointVoice).toBeNull()

    await updateShort(db, short.id, {
      pointVoice: voice,
      pointPlan: plan,
      pointFetches: fetches,
    })
    const stored = await getShort(db, short.id)
    expect(stored?.pointScript).toEqual(script)
    expect(stored?.pointVoice).toEqual(voice)
    expect(stored?.pointPlan).toEqual(plan)
    expect(stored?.pointFetches).toEqual(fetches)

    expect((await shortForPoint(db, FIXTURE_PROJECT_ID, pointId))?.id).toBe(short.id)
    expect(
      await shortForPoint(db, FIXTURE_PROJECT_ID, '01HQ0000000000000000000P02'),
    ).toBeUndefined()
  })

  it('lists a point Short only once its master is compiled; shortForPoint still finds the draft', async () => {
    const pointId = '01HQ0000000000000000000P03'
    const draft = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'Draft',
      segmentRef: { chapterId: '0P01NTP01NTP01NTP01NTP01NT', fromParagraph: 0, toParagraph: 4 },
      kind: 'point',
      pointId,
    })
    expect(isAssembledShort(draft)).toBe(false)
    expect((await listShorts(db, FIXTURE_PROJECT_ID)).map((row) => row.id)).not.toContain(draft.id)
    expect((await shortForPoint(db, FIXTURE_PROJECT_ID, pointId))?.id).toBe(draft.id)

    await updateShort(db, draft.id, { sourceTimeline: { version: 1 } })
    const done = await shortForPoint(db, FIXTURE_PROJECT_ID, pointId)
    expect(isAssembledShort(done!)).toBe(true)
    expect((await listShorts(db, FIXTURE_PROJECT_ID)).map((row) => row.id)).toContain(draft.id)
  })
  describe('the point studio claim', () => {
    const farPast = new Date('2000-01-01T00:00:00Z')
    const draftPoint = () =>
      insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Claim me',
        segmentRef: { chapterId: '0P01NTP01NTP01NTP01NTP01NT', fromParagraph: 0, toParagraph: 4 },
        kind: 'point',
        pointId: '01HQ0000000000000000000P09',
      })

    it('is won by exactly one of two presses and refused while the work is fresh', async () => {
      const row = await draftPoint()
      const cutoff = new Date(Date.now() - 10 * 60 * 1000)

      const results = await Promise.all([
        claimPointWork(db, row.id, 'plan', cutoff),
        claimPointWork(db, row.id, 'plan', cutoff),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect((await getShort(db, row.id))?.pointFetches).toMatchObject({
        candidates: [],
        state: { state: 'fetching', what: 'plan' },
      })
      expect(await claimPointWork(db, row.id, 'voice', cutoff)).toBe(false)
    })

    it('may be won again once the work is older than the cooldown', async () => {
      const row = await draftPoint()
      expect(await claimPointWork(db, row.id, 'still', farPast)).toBe(true)

      // The cutoff is now in the future of the claim's startedAt: it is stale.
      expect(await claimPointWork(db, row.id, 'still', new Date(Date.now() + 60_000))).toBe(true)
    })

    it('settles to null or to failed words without touching the stored pool', async () => {
      const row = await draftPoint()
      await updateShort(db, row.id, {
        pointFetches: { candidates: [], state: null },
      })
      expect(await claimPointWork(db, row.id, 'voice', farPast)).toBe(true)

      await settlePointWork(db, row.id, { state: 'failed', what: 'voice', reason: 'it broke' })
      expect((await getShort(db, row.id))?.pointFetches).toEqual({
        candidates: [],
        state: { state: 'failed', what: 'voice', reason: 'it broke' },
      })
      // A failed state is not work in flight: the next press may claim it.
      expect(await claimPointWork(db, row.id, 'voice', farPast)).toBe(true)
      await settlePointWork(db, row.id, null)
      expect((await getShort(db, row.id))?.pointFetches).toEqual({ candidates: [], state: null })
    })

    it('clears a point Short back to a draft with null records', async () => {
      const row = await draftPoint()
      await updateShort(db, row.id, { sourceTimeline: { version: 1 } })
      await updateShort(db, row.id, { sourceTimeline: null, pointScript: null, renderId: null })
      expect(isAssembledShort((await getShort(db, row.id))!)).toBe(false)
    })
  })
})

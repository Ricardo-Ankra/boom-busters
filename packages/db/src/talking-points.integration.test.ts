import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { TalkingPoint } from '@boom-busters/schemas'
import { ensureFirstChannel } from './channels'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import { claimShortsCheckpoint, getProject, setProjectStage } from './projects'
import { cases, projects } from './schema'
import {
  approveTalkingPointSet,
  approvedTalkingPointSet,
  insertTalkingPointSet,
  latestTalkingPointSet,
  listTalkingPointSets,
  stampTalkingPointSet,
} from './talking-points'
import { requireTestDatabase } from './test-database'

/**
 * Talking-point sets against a real database: append-only versions, approval
 * that refuses a set a newer proposal has overtaken, and the project's
 * Shorts phase.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const point = (n: number): TalkingPoint => ({
  id: `01HQ0000000000000000000P0${n}`,
  type: 'forensic-breakdown',
  title: `Point ${n} title`,
  question: `What did the auditors miss in year ${n}?`,
  payoff: 'They never tested the cash balances at all.',
  bridge: 'The long film walks through how that unravelled.',
  bridgeChapters: [1],
  sourceChapters: [0],
  hook: 'Nobody checked the one number that mattered.',
  order: n,
})

suite('talking-point sets', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  const insert = (note: string | null = null) =>
    insertTalkingPointSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      scriptVersion: 1,
      points: [point(1), point(2)],
      note,
    })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await ensureFirstChannel(db)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('appends versions 1, 2, 3 and reads the latest', async () => {
    expect(await latestTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
    const first = await insert()
    const second = await insert('fewer, sharper')
    const third = await insert()
    expect([first.version, second.version, third.version]).toEqual([1, 2, 3])
    expect(second.note).toBe('fewer, sharper')
    expect(first.approvedAt).toBeNull()
    expect(first.points[0]?.title).toBe('Point 1 title')
    expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(3)
  })

  it('lists every version, newest first', async () => {
    expect(await listTalkingPointSets(db, FIXTURE_PROJECT_ID)).toEqual([])
    await insert()
    await insert('fewer, sharper')
    const listed = await listTalkingPointSets(db, FIXTURE_PROJECT_ID)
    expect(listed.map((set) => set.version)).toEqual([2, 1])
    expect(listed[0]?.note).toBe('fewer, sharper')
  })

  it('approving a set overtaken by a newer version is stale and changes nothing', async () => {
    await insert()
    await insert()
    await insert()
    expect(await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, 2)).toBe('stale')
    expect(await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
    expect(await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, 3)).toBe('approved')
    expect((await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(3)
  })

  it('the stamp itself refuses a version a newer one has overtaken, with no pre-read', async () => {
    await insert()
    // The race: the owner's check passed on version 1, then a re-proposal landed.
    await insert()
    expect(await stampTalkingPointSet(db, FIXTURE_PROJECT_ID, 1)).toBe(false)
    expect(await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
    expect(await stampTalkingPointSet(db, FIXTURE_PROJECT_ID, 2)).toBe(true)
  })

  it('a version that does not exist is missing', async () => {
    await insert()
    expect(await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, 9)).toBe('missing')
  })

  it('approvedTalkingPointSet ignores unapproved later versions', async () => {
    await insert()
    expect(await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, 1)).toBe('approved')
    await insert()
    expect((await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(2)
  })

  it('setProjectStage writes and clears the shorts phase', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running', shortsPhase: 'points' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.shortsPhase).toBe('points')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.shortsPhase).toBe('points')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running', shortsPhase: null })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.shortsPhase).toBeNull()
  })

  it('claimShortsCheckpoint lets exactly one of two racing callers win', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'shorts',
      stageStatus: 'awaiting_review',
      shortsPhase: 'points',
    })
    const change = {
      from: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
      to: { shortsPhase: 'points', stageStatus: 'running' },
    } as const
    const results = await Promise.all([
      claimShortsCheckpoint(db, FIXTURE_PROJECT_ID, change),
      claimShortsCheckpoint(db, FIXTURE_PROJECT_ID, change),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('running')
    // And the wrong stage or phase never matches.
    expect(
      await claimShortsCheckpoint(db, FIXTURE_PROJECT_ID, {
        from: { shortsPhase: 'review', stageStatus: 'running' },
        to: { shortsPhase: 'points', stageStatus: 'awaiting_review' },
      }),
    ).toBe(false)
  })
})

// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsReplanner } from './visuals-replanner'

/**
 * The visuals-replanner against the real database, in mock-provider mode
 * (decision 252): `shots` replaces the plan and keeps the owner's book,
 * `direction` replaces the book and leaves the plan alone, and neither runs
 * outside the plan checkpoint.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

function replanEvent(op: 'direction' | 'shots'): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'visuals/replan.requested', data: { projectId: FIXTURE_PROJECT_ID, op } }]
}

describeDb('visuals-replanner (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'old',
          description: 'old plan',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'old',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 5000,
      },
    ])
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
      visualThesis: 'owner edit',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('op shots replaces the slots and keeps the owner’s book', async () => {
    const { result } = await engine.execute({ events: replanEvent('shots') })
    expect(result).toMatchObject({ outcome: 'replanned' })

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.brief['description'] !== 'old plan')).toBe(true)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })

  it('op direction replaces the book and leaves the slots alone', async () => {
    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).not.toMatchObject({
      visualThesis: 'owner edit',
    })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('shots') })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief['description']).toBe('old plan')
  })
})

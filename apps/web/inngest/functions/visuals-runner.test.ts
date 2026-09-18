// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  listShotSlots,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { DirectorsBookSchema } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsRunner } from './visuals-runner'

/**
 * The visuals-runner against the real database, in mock-provider mode
 * (decision 252): the Director's Book is drafted before the first chapter is
 * planned, the plan is written against it, and the run parks on the plan.
 * The park would wait 30 days, so the test answers it with "no decision".
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('visuals-runner (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsRunner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.\n\nThe trail led to Manila.',
      estRuntimeSec: 30,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drafts the book, plans against it, and parks on the plan', async () => {
    // `step.waitForEvent` is non-runnable in the harness (see the demo-pipeline
    // test), so the run is driven up to the step that opens the plan park and
    // the database is read from there.
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project?.direction).toMatchObject({ motifs: expect.any(Array) })
    expect(project?.visualsPhase).toBe('plan')

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some((slot) => (slot.brief as { shotSize?: string }).shotSize)).toBe(true)
  })

  it('reuses an owner-edited book instead of redrafting it', async () => {
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    const drafted = DirectorsBookSchema.parse((await getProject(db, FIXTURE_PROJECT_ID))?.direction)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...drafted,
      visualThesis: 'edited by the owner',
    })

    const again = new InngestTestEngine({ function: visualsRunner })
    await again.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'edited by the owner',
    })
  })

  // The copy-reused-shots step (decision 261) has no engine test: the run
  // cannot be driven past step.waitForEvent in this harness, even with the
  // wait stubbed (the limit demo-pipeline.test.ts describes). The step is one
  // line over copyReusedShots, which the db integration suite proves; the
  // refetcher guard, which has no wait in front of it, is proved in
  // slot-refetcher.test.ts.
})

// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  ensureRun,
  recordRunEvent,
  requireTestDatabase,
  seed,
  setProjectStage,
  setRunStatus,
  truncateRunMirror,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { needsYouCount } from './needs-you-count'

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('needsYouCount', () => {
  beforeEach(async () => {
    await seed(db)
    await truncateRunMirror(db)
  })

  it("counts each channel's own awaiting review, budget gates and failed runs", async () => {
    const make = () =>
      createChannel(db, {
        name: 'Counted',
        handle: null,
        slug: `count-${Math.random().toString(36).slice(2, 9)}`,
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      })
    const a = await make()
    const b = await make()
    expect(await needsYouCount(db, a.id)).toBe(0)

    // One project awaiting review in A.
    const kase = await createCase(db, { channelId: a.id, title: 'Review me', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Review me' })
    await setProjectStage(db, project.id, { stage: 'dossier', stageStatus: 'awaiting_review' })

    // One open budget gate and one failed run in A.
    const gate = await ensureRun(db, {
      inngestRunId: `count-gate-${a.id}`,
      functionName: 'demo-runner',
      channelId: a.id,
    })
    await recordRunEvent(db, { runId: gate, kind: 'gate.opened', data: { gate: 'budget' } })
    await setRunStatus(db, gate, 'awaiting_gate')
    const failed = await ensureRun(db, {
      inngestRunId: `count-failed-${a.id}`,
      functionName: 'demo-runner',
      channelId: a.id,
    })
    await setRunStatus(db, failed, 'failed', { message: 'broke' })

    expect(await needsYouCount(db, a.id)).toBe(3)
    expect(await needsYouCount(db, b.id)).toBe(0)
  })
})

// @vitest-environment node

import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  createProjectFromCase,
  createScriptVersion,
  deleteProject,
  ensureRun,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  saveDossier,
  seed,
  setProjectStage,
  setRunStatus,
  setSlotJob,
  truncateRunMirror,
} from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { approveGate, requestChanges } from './actions'

/**
 * The dossier's change request and approval against the test database, with
 * the seams a server action cannot bring to a unit test replaced: session,
 * cache revalidation and Inngest. Changes can be asked for at any time a
 * dossier exists and no run is writing from it (design decision 7).
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const inngest = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => inngest.send(...args) },
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const NOTE = 'More on the auditors, please.'

describeDb('requestChanges on the dossier', () => {
  let projectId = ''

  beforeEach(async () => {
    inngest.send.mockReset()
    inngest.send.mockResolvedValue(undefined)
    await seed(db)
    await truncateRunMirror(db)
    // A project of its own with a dossier of no claims, so nothing blocks
    // Approve and the fixture dossier other suites read is never rewritten.
    projectId = (
      await createProjectFromCase(db, { caseId: FIXTURE_CASE_ID, title: 'Changes test (unit)' })
    ).id
    await saveDossier(db, { projectId, contentMd: '# A dossier', claims: [] })
  })

  afterEach(async () => {
    await deleteProject(db, projectId)
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it('sends the note at the open dossier gate', async () => {
    await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'awaiting_review' })

    expect(await requestChanges(projectId, 'dossier', NOTE)).toEqual({ ok: true })
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'gate/dossier.changes_requested',
        data: { projectId, note: NOTE },
      }),
    )
  })

  it('sends the note after approval, with the project at the script gate', async () => {
    await setProjectStage(db, projectId, { stage: 'script', stageStatus: 'awaiting_review' })

    expect(await requestChanges(projectId, 'dossier', NOTE)).toEqual({ ok: true })
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'gate/dossier.changes_requested',
        data: { projectId, note: NOTE },
      }),
    )
  })

  it('refuses while the dossier is being researched', async () => {
    await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'running' })

    const result = await requestChanges(projectId, 'dossier', NOTE)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/being researched/)
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('refuses a second request, and the parked script gate, while a revision after approval runs', async () => {
    // What the reviser's load-case leaves after approval: the project back on
    // the dossier, running, with the script runner still parked at its gate.
    await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'running' })
    const scriptRun = await ensureRun(db, {
      inngestRunId: `script-${projectId}`,
      functionName: 'script-runner',
      projectId,
      stage: 'script',
    })
    await setRunStatus(db, scriptRun, 'awaiting_gate')

    const again = await requestChanges(projectId, 'dossier', 'And the escrow accounts.')
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/being researched/)
    expect(await approveGate(projectId, 'script')).toEqual({
      ok: false,
      error: 'No run is waiting at this gate.',
    })
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('refuses while the script is being written from the dossier', async () => {
    await setProjectStage(db, projectId, { stage: 'script', stageStatus: 'running' })

    const result = await requestChanges(projectId, 'dossier', NOTE)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/script stage is running/)
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('refuses a project with no dossier', async () => {
    const bare = await createProjectFromCase(db, {
      caseId: FIXTURE_CASE_ID,
      title: 'No dossier yet (unit)',
    })
    try {
      await setProjectStage(db, bare.id, { stage: 'script', stageStatus: 'failed' })

      const result = await requestChanges(bare.id, 'dossier', NOTE)

      expect(result).toEqual({ ok: false, error: 'There is no dossier yet to change.' })
      expect(inngest.send).not.toHaveBeenCalled()
    } finally {
      await deleteProject(db, bare.id)
    }
  })

  it('still asks for a note before anything else', async () => {
    expect(await requestChanges(projectId, 'dossier', '   ')).toEqual({
      ok: false,
      error: 'Say what needs to change.',
    })
  })

  it('approves the re-opened gate held by the revision, which starts a fresh script', async () => {
    // What the reviser leaves after a revision asked for at the script gate:
    // the project back at the dossier review, and its own run waiting on it.
    await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'awaiting_review' })
    const runId = await ensureRun(db, {
      inngestRunId: `reviser-${projectId}`,
      functionName: 'dossier-reviser',
      projectId,
    })
    await setRunStatus(db, runId, 'awaiting_gate')

    expect(await approveGate(projectId, 'dossier')).toEqual({ ok: true })
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'gate/dossier.approved',
        data: { projectId, approvedBy: 'owner@example.com' },
      }),
    )
  })
})

describeDb('approving the visuals gate while a stretch re-plan runs', () => {
  let projectId = ''

  beforeEach(async () => {
    inngest.send.mockReset()
    inngest.send.mockResolvedValue(undefined)
    await seed(db)
    await truncateRunMirror(db)
    projectId = (
      await createProjectFromCase(db, { caseId: FIXTURE_CASE_ID, title: 'Stretch gate (unit)' })
    ).id
    const script = await createScriptVersion(db, projectId)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, projectId, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'One.',
          description: 'the lobby',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'office',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 6000,
      },
    ])
    await setProjectStage(db, projectId, { stage: 'visuals', stageStatus: 'awaiting_review' })
    const runId = await ensureRun(db, {
      inngestRunId: `visuals-${projectId}`,
      functionName: 'visuals-runner',
      projectId,
      stage: 'visuals',
    })
    await setRunStatus(db, runId, 'awaiting_gate')
  })

  afterEach(async () => {
    await deleteProject(db, projectId)
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it('refuses, so the write cannot land on an approved list', async () => {
    const [slot] = await listShotSlots(db, projectId)
    await setSlotJob(db, slot!.id, {
      kind: 'stretch',
      jobId: newId(),
      startedAt: new Date().toISOString(),
    })
    expect(await approveGate(projectId, 'visuals')).toEqual({
      ok: false,
      error: 'Wait for the stretch re-plan to finish.',
    })
    expect(inngest.send).not.toHaveBeenCalled()
  })
})

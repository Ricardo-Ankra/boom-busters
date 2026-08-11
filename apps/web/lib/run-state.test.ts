import type { ProjectStage, StageStatus } from '@boom-busters/db'
import { describe, expect, it } from 'vitest'
import { QUEUED_STUCK_AFTER_MS, isGateOpen, isMoving, projectControl } from './run-state'

describe('isMoving', () => {
  it('is true while a run is executing', () => {
    expect(isMoving({ stageStatus: 'running' }, true)).toBe(true)
  })

  it('is true in the window after Start, before Inngest creates the run', () => {
    // The gap that made a freshly started project sit frozen on "Queued".
    expect(isMoving({ stageStatus: 'queued' }, false)).toBe(true)
  })

  it('is true at a gate, because the approval lands seconds later elsewhere', () => {
    expect(isMoving({ stageStatus: 'awaiting_review' }, true)).toBe(true)
  })

  it('stops once nothing is in flight', () => {
    expect(isMoving({ stageStatus: 'approved' }, false)).toBe(false)
    expect(isMoving({ stageStatus: 'failed' }, false)).toBe(false)
    expect(isMoving({ stageStatus: 'cancelled' }, false)).toBe(false)
  })

  it('does not poll forever on a project stranded at a review', () => {
    expect(isMoving({ stageStatus: 'awaiting_review' }, false)).toBe(false)
  })
})

describe('isGateOpen', () => {
  it('needs both the parked project and a run waiting on it', () => {
    expect(isGateOpen({ stageStatus: 'awaiting_review' }, true)).toBe(true)
    expect(isGateOpen({ stageStatus: 'awaiting_review' }, false)).toBe(false)
    expect(isGateOpen({ stageStatus: 'running' }, true)).toBe(false)
  })
})

describe('the gate bar and the restart button are mutually exclusive', () => {
  it('never offers both an approval and a way to re-run the same stage', () => {
    // Both at once would be a screen asking you to approve a gate and telling
    // you nothing is waiting at it. `projectControl` covers the stranded case
    // that `isGateOpen` refuses; nothing may cover both.
    for (const liveRun of [true, false]) {
      const project = {
        stage: 'dossier',
        stageStatus: 'awaiting_review',
        updatedAt: new Date(),
      } as const
      const control = projectControl(project, liveRun)
      expect(isGateOpen(project, liveRun) && control.kind === 'restart').toBe(false)
    }
  })
})

describe('projectControl', () => {
  const NOW = new Date('2026-08-11T12:00:00Z')
  const agedBy = (ms: number) => new Date(NOW.getTime() - ms)

  const project = (
    stage: ProjectStage,
    stageStatus: StageStatus,
    ageMs = 0,
  ): { stage: ProjectStage; stageStatus: StageStatus; updatedAt: Date } => ({
    stage,
    stageStatus,
    updatedAt: agedBy(ageMs),
  })

  const ALL_STATUSES: readonly StageStatus[] = [
    'queued',
    'running',
    'awaiting_review',
    'approved',
    'failed',
    'cancelled',
  ]

  /**
   * The regression this whole function exists for.
   *
   * A project created from a case is `dossier`/`queued` with no run mirrored
   * yet, and its research is already on its way. Every start-shaped control the
   * console could show here is a way to interfere with it.
   */
  it('offers no button on a project whose research is already on its way', () => {
    const control = projectControl(project('dossier', 'queued'), false, NOW)

    expect(control.kind).toBe('working')
    expect(control).toMatchObject({ message: expect.stringContaining('nothing to press') })
  })

  it('never offers a start control while a run is in flight', () => {
    // Whatever the project row claims, a live run means the only honest
    // control is Stop — including at a gate, where Stop must stay reachable.
    for (const status of ALL_STATUSES) {
      expect(projectControl(project('dossier', status), true, NOW)).toEqual({ kind: 'stop' })
    }
  })

  it('stops calling it "starting" once the event has plainly never arrived', () => {
    const stalled = projectControl(
      project('dossier', 'queued', QUEUED_STUCK_AFTER_MS + 1_000),
      false,
      NOW,
    )

    expect(stalled.kind).toBe('restart')
    expect(stalled).toMatchObject({ message: expect.stringContaining('Inngest') })
  })

  it('holds the soothing message right up to the threshold', () => {
    // A boundary rather than a vibe: at exactly the cutoff it is still
    // starting, so a slow-but-fine pickup does not flash a scary button.
    expect(
      projectControl(project('dossier', 'queued', QUEUED_STUCK_AFTER_MS), false, NOW).kind,
    ).toBe('working')
  })

  it('offers a way out of every dead end a human can reach', () => {
    // Stop, a failure, and the stranded state all used to leave the project
    // screen offering the demo pipeline as its only button — which reset the
    // stage and started a no-op run.
    for (const status of ['failed', 'cancelled', 'awaiting_review'] as const) {
      const control = projectControl(project('dossier', status), false, NOW)
      expect(control.kind).toBe('restart')
      expect(control).toMatchObject({ label: expect.stringContaining('dossier') })
    }
  })

  it('restarts the script stage too, since its runner also re-enters on one event', () => {
    expect(projectControl(project('script', 'failed'), false, NOW)).toMatchObject({
      kind: 'restart',
    })
  })

  it('refuses to offer a restart for a stage that has no runner yet', () => {
    // A button that sends an event nothing subscribes to would report success
    // and do nothing, which is worse than saying so.
    for (const stage of ['voice', 'visuals', 'assembly', 'shorts', 'publish'] as const) {
      const control = projectControl(project(stage, 'failed'), false, NOW)
      expect(control.kind).toBe('blocked')
      expect(control).toMatchObject({ message: expect.stringContaining('arrives with its runner') })
    }
  })

  it('always says something, whatever combination it is handed', () => {
    const STAGES: readonly ProjectStage[] = [
      'dossier',
      'script',
      'voice',
      'visuals',
      'assembly',
      'shorts',
      'publish',
    ]

    for (const stage of STAGES) {
      for (const status of ALL_STATUSES) {
        for (const liveRun of [true, false]) {
          const control = projectControl(project(stage, status), liveRun, NOW)
          if (control.kind !== 'stop') expect(control.message.length).toBeGreaterThan(10)
        }
      }
    }
  })
})

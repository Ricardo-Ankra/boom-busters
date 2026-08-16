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

  it('does not believe a `running` column with no run behind it', () => {
    // `ensureRun` fires on run start, before any step, so a genuinely running
    // runner always has a mirror row. `running` without one means a runner set
    // that column and then stopped existing — and polling on it told the user
    // something was happening for as long as they were willing to watch.
    expect(isMoving({ stageStatus: 'running' }, false)).toBe(false)
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
      const control = projectControl(project, liveRun, { hasDossier: true, hasScript: true })
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
    const control = projectControl(project('dossier', 'queued'), false, {
      hasDossier: true,
      hasScript: true,
      now: NOW,
    })

    expect(control.kind).toBe('working')
    expect(control).toMatchObject({ message: expect.stringContaining('nothing to press') })
  })

  it('never offers a start control while a run is in flight', () => {
    // Whatever the project row claims, a live run means the only honest
    // control is Stop — including at a gate, where Stop must stay reachable.
    for (const status of ALL_STATUSES) {
      expect(
        projectControl(project('dossier', status), true, {
          hasDossier: true,
          hasScript: true,
          now: NOW,
        }),
      ).toEqual({ kind: 'stop' })
    }
  })

  it('stops calling it "starting" once the event has plainly never arrived', () => {
    const stalled = projectControl(
      project('dossier', 'queued', QUEUED_STUCK_AFTER_MS + 1_000),
      false,
      { hasDossier: true, hasScript: true, now: NOW },
    )

    expect(stalled.kind).toBe('restart')
    expect(stalled).toMatchObject({ message: expect.stringContaining('Inngest') })
  })

  it('holds the soothing message right up to the threshold', () => {
    // A boundary rather than a vibe: at exactly the cutoff it is still
    // starting, so a slow-but-fine pickup does not flash a scary button.
    expect(
      projectControl(project('dossier', 'queued', QUEUED_STUCK_AFTER_MS), false, {
        hasDossier: true,
        hasScript: true,
        now: NOW,
      }).kind,
    ).toBe('working')
  })

  it('offers a way out of every dead end a human can reach', () => {
    // Stop, a failure, and the stranded state all used to leave the project
    // screen offering the demo pipeline as its only button — which reset the
    // stage and started a no-op run.
    for (const status of ['failed', 'cancelled', 'awaiting_review'] as const) {
      const control = projectControl(project('dossier', status), false, {
        hasDossier: true,
        hasScript: true,
        now: NOW,
      })
      expect(control.kind).toBe('restart')
      expect(control).toMatchObject({ label: expect.stringContaining('dossier') })
    }
  })

  it('restarts the script stage too, since its runner also re-enters on one event', () => {
    expect(
      projectControl(project('script', 'failed'), false, {
        hasDossier: true,
        hasScript: true,
        now: NOW,
      }),
    ).toMatchObject({
      kind: 'restart',
    })
  })

  it('refuses to offer a restart for a stage that has no runner yet', () => {
    // A button that sends an event nothing subscribes to would report success
    // and do nothing, which is worse than saying so.
    for (const stage of ['assembly', 'shorts', 'publish'] as const) {
      const control = projectControl(project(stage, 'failed'), false, {
        hasDossier: true,
        hasScript: true,
        now: NOW,
      })
      expect(control.kind).toBe('blocked')
      expect(control).toMatchObject({ message: expect.stringContaining('arrives with its runner') })
    }
  })

  it('offers a restart for the voice and visuals stages, whose runners exist', () => {
    for (const stage of ['voice', 'visuals'] as const) {
      expect(
        projectControl(project(stage, 'failed'), false, {
          hasDossier: true,
          hasScript: true,
          now: NOW,
        }),
      ).toMatchObject({ kind: 'restart' })
    }
  })

  it('blocks a visuals restart when there is no script to plan against', () => {
    const control = projectControl(project('visuals', 'failed'), false, {
      hasDossier: true,
      hasScript: false,
      now: NOW,
    })
    expect(control.kind).toBe('blocked')
    expect(control).toMatchObject({
      message: expect.stringContaining('no script to plan visuals for'),
    })
  })

  /**
   * The `hasDossier` lesson, applied one stage down before it can happen again.
   * The voice runner's first step loads the script and gives up without one, so
   * a `voice`/`failed` project with no script would be offered a button that
   * could only ever fail.
   */
  it('refuses to re-run the voice stage with no script to narrate', () => {
    const control = projectControl(project('voice', 'failed'), false, {
      hasDossier: true,
      hasScript: false,
      now: NOW,
    })

    expect(control.kind).toBe('blocked')
    expect(control).toMatchObject({
      message: expect.stringContaining('no script to narrate'),
    })
  })

  /**
   * Taken straight from the production run mirror.
   *
   * A `script`/`failed` project with no dossier row was offered "Run the script
   * stage again". The script runner's first step loads the dossier and gives
   * up without one, so the button could only ever fail — and did, on
   * `load-dossier`: "The dossier is gone, so there is nothing to script from."
   */
  it('does not offer to re-run a script that has no dossier to be written from', () => {
    for (const status of ['failed', 'cancelled', 'awaiting_review'] as const) {
      const control = projectControl(project('script', status), false, {
        hasDossier: false,
        hasScript: true,
        now: NOW,
      })

      expect(control.kind).toBe('blocked')
      expect(control).toMatchObject({
        message: expect.stringContaining('run the dossier stage first'),
      })
    }
  })

  it('still offers the dossier stage when there is no dossier — that is the point of it', () => {
    expect(
      projectControl(project('dossier', 'failed'), false, {
        hasDossier: false,
        hasScript: true,
        now: NOW,
      }),
    ).toMatchObject({ kind: 'restart' })
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
          for (const hasDossier of [true, false]) {
            for (const hasScript of [true, false]) {
              const control = projectControl(project(stage, status), liveRun, {
                hasDossier,
                hasScript,
                now: NOW,
              })
              if (control.kind !== 'stop') expect(control.message.length).toBeGreaterThan(10)
            }
          }
        }
      }
    }
  })
})

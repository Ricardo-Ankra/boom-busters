import { describe, expect, it } from 'vitest'
import { isGateOpen, isMoving, isStranded } from './run-state'

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

describe('isStranded', () => {
  it('names the combination that needs explaining rather than a button', () => {
    expect(isStranded({ stageStatus: 'awaiting_review' }, false)).toBe(true)
    expect(isStranded({ stageStatus: 'awaiting_review' }, true)).toBe(false)
    expect(isStranded({ stageStatus: 'queued' }, false)).toBe(false)
  })

  it('is never true at the same time as the gate being open', () => {
    for (const liveRun of [true, false]) {
      const project = { stageStatus: 'awaiting_review' } as const
      expect(isGateOpen(project, liveRun) && isStranded(project, liveRun)).toBe(false)
    }
  })
})

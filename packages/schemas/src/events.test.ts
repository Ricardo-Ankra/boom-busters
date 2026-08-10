import { describe, expect, it } from 'vitest'
import { fixtureId } from './ids'
import {
  EVENT_NAMES,
  EVENT_SCHEMAS,
  GATE_STAGES,
  gateApprovedEvent,
  gateChangesRequestedEvent,
  parseEventData,
} from './events'

const projectId = fixtureId('project', 1)
const caseId = fixtureId('case', 1)

describe('event registry', () => {
  it('names every event `<domain>/<subject>[.<verb>]`, per spec section 7', () => {
    for (const name of EVENT_NAMES) {
      expect(name).toMatch(/^[a-z]+\/[a-z_]+(\.[a-z_]+)?$/)
    }
  })

  it('defines an approved and a changes_requested event for all five gates', () => {
    for (const stage of GATE_STAGES) {
      expect(EVENT_NAMES).toContain(gateApprovedEvent(stage))
      expect(EVENT_NAMES).toContain(gateChangesRequestedEvent(stage))
    }
  })

  it('uses no defaults — Inngest rejects a schema whose input and output differ', () => {
    // A `.default()` makes a field optional on the way in and required on the
    // way out, which Standard Schema treats as a transform. Asserted here
    // rather than discovered at the client, where the error is a wall of
    // conditional-type text.
    for (const [name, schema] of Object.entries(EVENT_SCHEMAS)) {
      for (const [field, shape] of Object.entries(schema.shape)) {
        expect(shape.def.type, `${name}.${field} must not carry a default`).not.toBe('default')
      }
    }
  })
})

describe('payload validation', () => {
  it('accepts a well-formed project/created', () => {
    expect(parseEventData('project/created', { projectId, caseId })).toEqual({ projectId, caseId })
  })

  it('rejects a non-ULID id, so a bad event never reaches a runner', () => {
    expect(() => parseEventData('project/created', { projectId: 'nope', caseId })).toThrow()
  })

  it('makes a cancellation state its reason — a run that vanished silently is a support case', () => {
    expect(() => parseEventData('project/cancelled', { projectId })).toThrow()
    expect(parseEventData('project/cancelled', { projectId, reason: 'stopped by user' })).toEqual({
      projectId,
      reason: 'stopped by user',
    })
  })

  it('requires a change request to say what to change', () => {
    expect(() => parseEventData('gate/script.changes_requested', { projectId, note: '' })).toThrow()
    expect(
      parseEventData('gate/script.changes_requested', { projectId, note: 'cut chapter 3' }),
    ).toEqual({ projectId, note: 'cut chapter 3' })
  })

  it('lets a gate approval carry the approver, but does not demand one', () => {
    expect(parseEventData('gate/dossier.approved', { projectId })).toEqual({ projectId })
    expect(
      parseEventData('gate/dossier.approved', { projectId, approvedBy: 'owner@example.com' }),
    ).toEqual({ projectId, approvedBy: 'owner@example.com' })
    expect(() =>
      parseEventData('gate/dossier.approved', { projectId, approvedBy: 'nope' }),
    ).toThrow()
  })

  it('requires the overage amount on a budget approval — approving must be a number, not a nod', () => {
    expect(() => parseEventData('budget/approved', { projectId, provider: 'anthropic' })).toThrow()
    expect(
      parseEventData('budget/approved', { projectId, provider: 'anthropic', additionalUsd: 5 }),
    ).toEqual({ projectId, provider: 'anthropic', additionalUsd: 5 })
  })

  it('constrains render failure reasons to the two the broker can report', () => {
    const renderId = fixtureId('render', 1)
    expect(parseEventData('render/failed', { projectId, renderId, reason: 'timeout' })).toEqual({
      projectId,
      renderId,
      reason: 'timeout',
    })
    expect(() =>
      parseEventData('render/failed', { projectId, renderId, reason: 'cancelled' }),
    ).toThrow()
  })

  it('lets the demo pipeline run without opting into the budget gate', () => {
    expect(parseEventData('demo/pipeline.requested', { projectId })).toEqual({ projectId })
    expect(parseEventData('demo/pipeline.requested', { projectId, forceBudgetGate: true })).toEqual(
      { projectId, forceBudgetGate: true },
    )
  })
})

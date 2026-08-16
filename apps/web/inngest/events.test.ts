import { EVENT_NAMES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { BOUND_EVENT_NAMES } from './events'

/**
 * The drift test `events.ts` promises. The bindings hand-transcribe every
 * event name because a mapped object would lose the string literal types —
 * which means a schema added to `EVENT_SCHEMAS` without a binding (or a typo
 * in either place) compiles fine and fails only when something tries to send
 * or trigger on the missing name. This is exactly the failure mode the
 * hand-transcription risks, so it is asserted rather than assumed.
 */
describe('event bindings', () => {
  it('bind exactly the names the schema registry declares', () => {
    expect([...BOUND_EVENT_NAMES].sort()).toEqual([...EVENT_NAMES].sort())
  })

  it('bind each name once', () => {
    expect(new Set(BOUND_EVENT_NAMES).size).toBe(BOUND_EVENT_NAMES.length)
  })
})

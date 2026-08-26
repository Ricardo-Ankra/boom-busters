import { describe, expect, it } from 'vitest'
import type { ShotBrief } from '@boom-busters/schemas'
import { shotBriefHash, slotNeedsResolution } from './visuals'

/**
 * The no-waste guard's pure half (staged-visuals design, 2026-08-26): pure
 * functions, no database. The write paths are exercised through the runner
 * and action suites against the test container.
 */

const brief: ShotBrief = {
  type: 'stock',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office dusk',
  rejectionCriteria: [],
}

describe('shotBriefHash', () => {
  it('is stable for the same value and moves for any edit', () => {
    expect(shotBriefHash(brief)).toBe(shotBriefHash({ ...brief }))
    expect(shotBriefHash(brief)).not.toBe(shotBriefHash({ ...brief, query: 'boardroom' }))
  })
})

describe('slotNeedsResolution', () => {
  const hash = shotBriefHash(brief)

  it('owes nothing to a slot resolved for its current brief', () => {
    expect(slotNeedsResolution({ status: 'resolved', brief, resolvedBriefHash: hash })).toBe(false)
  })

  it('owes work to anything unresolved or placeholder', () => {
    expect(slotNeedsResolution({ status: 'unresolved', brief, resolvedBriefHash: hash })).toBe(true)
    expect(slotNeedsResolution({ status: 'placeholder', brief, resolvedBriefHash: null })).toBe(
      true,
    )
  })

  it('owes work to a resolved slot whose brief moved on — the edit IS the trigger', () => {
    expect(
      slotNeedsResolution({
        status: 'resolved',
        brief: { ...brief, query: 'boardroom' },
        resolvedBriefHash: hash,
      }),
    ).toBe(true)
  })

  it('owes work to a resolution with no fingerprint (legacy rows, uploads aside)', () => {
    expect(slotNeedsResolution({ status: 'resolved', brief, resolvedBriefHash: null })).toBe(true)
  })
})

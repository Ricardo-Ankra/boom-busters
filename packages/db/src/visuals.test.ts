import { createHash } from 'node:crypto'
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

  it('ignores key order, nested and in the route (decision 323)', () => {
    // Inngest hands step data back with its keys sorted; Postgres jsonb keeps
    // its own order. The same brief must stamp the same either way.
    const reordered = sortKeys(brief) as ShotBrief
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(brief))
    expect(shotBriefHash(reordered)).toBe(shotBriefHash(brief))
    const route = { provider: 'google', model: 'gemini-3-pro-image' }
    expect(shotBriefHash(reordered, { model: route.model, provider: route.provider })).toBe(
      shotBriefHash(brief, route),
    )
  })
})

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** The order-sensitive stamp every row written before decision 323 holds. */
function legacyHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

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

  it('owes nothing to a slot stamped from a key-sorted copy of its brief (decision 323)', () => {
    expect(
      slotNeedsResolution({
        status: 'resolved',
        brief,
        resolvedBriefHash: legacyHash(sortKeys(brief)),
      }),
    ).toBe(false)
  })

  it('still honours a stamp written in the old, order-sensitive form', () => {
    const route = { provider: 'google', model: 'gemini-3-pro-image' }
    expect(
      slotNeedsResolution({ status: 'resolved', brief, resolvedBriefHash: legacyHash(brief) }),
    ).toBe(false)
    expect(
      slotNeedsResolution({
        status: 'resolved',
        brief,
        route,
        resolvedBriefHash: legacyHash({ brief, route }),
      }),
    ).toBe(false)
    expect(
      slotNeedsResolution({
        status: 'resolved',
        brief: { ...brief, query: 'boardroom' },
        resolvedBriefHash: legacyHash(brief),
      }),
    ).toBe(true)
  })

  it('owes work to a resolution with no fingerprint (legacy rows, uploads aside)', () => {
    expect(slotNeedsResolution({ status: 'resolved', brief, resolvedBriefHash: null })).toBe(true)
  })

  it('owes nothing to a linked slot, whatever its status or hash (decision 261)', () => {
    expect(
      slotNeedsResolution({
        status: 'unresolved',
        brief,
        resolvedBriefHash: null,
        reuseOfSlotId: '01J000000000000000000000AA',
      }),
    ).toBe(false)
  })
})

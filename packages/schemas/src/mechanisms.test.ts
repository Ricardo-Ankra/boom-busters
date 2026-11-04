import { describe, expect, it } from 'vitest'
import {
  MECHANISM_KEYS,
  MECHANISMS,
  MECHANISMS_PER_DESIGN_MAX,
  MechanismSchema,
  mechanismName,
} from './mechanisms'

describe('the mechanisms (spec 2026-11-04, section 8.5)', () => {
  it('lists sixteen unique kebab-case keys, each with a one-line definition', () => {
    expect(MECHANISMS).toHaveLength(16)
    expect(new Set(MECHANISMS.map((m) => m.key)).size).toBe(16)
    for (const { key, definition } of MECHANISMS) {
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/)
      expect(definition.length).toBeGreaterThan(10)
      expect(definition.length).toBeLessThanOrEqual(140)
      expect(definition).not.toMatch(/[–—]/)
    }
    expect(MECHANISM_KEYS).toEqual(MECHANISMS.map((m) => m.key))
    expect(MECHANISM_KEYS[0]).toBe('persistent-actor')
    expect(MECHANISM_KEYS[15]).toBe('camera-push')
  })

  it('names a mechanism in words and validates a key', () => {
    expect(mechanismName('rise-from-baseline')).toBe('rise from baseline')
    expect(MechanismSchema.safeParse('drum').success).toBe(true)
    expect(MechanismSchema.safeParse('jazz-hands').success).toBe(false)
    expect(MECHANISMS_PER_DESIGN_MAX).toBe(6)
  })
})

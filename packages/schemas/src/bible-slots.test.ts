import { describe, expect, test } from 'vitest'
import { EXAMPLE_SLOT_IDS, EXAMPLE_SLOTS, MAX_EXAMPLE_SLOTS } from './bible-slots'

describe('bible slots', () => {
  test('the registry stays within its cap and its ids are unique kebab-case', () => {
    expect(EXAMPLE_SLOTS.length).toBeLessThanOrEqual(MAX_EXAMPLE_SLOTS)
    expect(new Set(EXAMPLE_SLOT_IDS).size).toBe(EXAMPLE_SLOT_IDS.length)
    for (const id of EXAMPLE_SLOT_IDS) expect(id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/)
  })
})

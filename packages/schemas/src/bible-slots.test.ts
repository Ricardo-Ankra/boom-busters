import { describe, expect, test } from 'vitest'
import { EXAMPLE_SLOT_IDS, EXAMPLE_SLOTS, MAX_EXAMPLE_SLOTS, RETIRED_SLOT_IDS } from './bible-slots'

describe('bible slots', () => {
  test('the registry stays within its cap and its ids are unique kebab-case', () => {
    expect(EXAMPLE_SLOTS.length).toBeLessThanOrEqual(MAX_EXAMPLE_SLOTS)
    expect(new Set(EXAMPLE_SLOT_IDS).size).toBe(EXAMPLE_SLOT_IDS.length)
    for (const id of EXAMPLE_SLOT_IDS) expect(id).toMatch(/^[a-z]+(-[a-z0-9]+)+$/)
  })

  test('holds 44 slots and none of the retired ones', () => {
    expect(EXAMPLE_SLOTS).toHaveLength(44)
    for (const id of RETIRED_SLOT_IDS) expect(EXAMPLE_SLOT_IDS).not.toContain(id)
    expect(EXAMPLE_SLOTS.find((s) => s.id === 'direction-worked-example')?.kind).toBe('passage')
  })
})

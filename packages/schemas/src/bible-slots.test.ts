import { describe, expect, test } from 'vitest'
import {
  EXAMPLE_SLOT_IDS,
  EXAMPLE_SLOTS,
  MAX_EXAMPLE_SLOTS,
  RETIRED_SLOT_IDS,
  SLOT_STAGE_LABELS,
  SLOT_STAGES,
  examplesWritten,
  slotStage,
} from './bible-slots'

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

  test('gives every slot a short, unique, human title', () => {
    const titles = EXAMPLE_SLOTS.map((s) => s.title)
    expect(new Set(titles).size).toBe(EXAMPLE_SLOTS.length)
    for (const slot of EXAMPLE_SLOTS) {
      expect(slot.title.length).toBeGreaterThan(0)
      expect(slot.title.length).toBeLessThanOrEqual(48)
      expect(slot.title).not.toMatch(/[–—]/)
      expect(slot.title).not.toContain(slot.id)
    }
  })

  test('places every slot in a stage, in stage order', () => {
    const counts = Object.fromEntries(
      SLOT_STAGES.map((s) => [s, EXAMPLE_SLOTS.filter((x) => slotStage(x) === s).length]),
    )
    expect(counts).toEqual({ script: 13, research: 6, direction: 17, shotlist: 4, metadata: 4 })
    expect(slotStage(EXAMPLE_SLOTS.find((s) => s.id === 'digest-channel-subject')!)).toBe(
      'research',
    )
    expect(SLOT_STAGES).toEqual(['script', 'research', 'direction', 'shotlist', 'metadata'])
    expect(SLOT_STAGE_LABELS).toEqual({
      script: 'Script',
      research: 'Research',
      direction: 'Direction',
      shotlist: 'Shot list',
      metadata: 'Titles and descriptions',
    })
  })

  test('slotStage throws on an id with an unknown prefix', () => {
    const slot = { ...EXAMPLE_SLOTS[0]!, id: 'mystery-slot' }
    expect(() => slotStage(slot)).toThrow(/mystery-slot/)
  })

  test('examplesWritten counts registered slots with non-blank text', () => {
    expect(examplesWritten({})).toBe(0)
    const all = Object.fromEntries(EXAMPLE_SLOT_IDS.map((id) => [id, 'x']))
    expect(examplesWritten(all)).toBe(44)
    expect(examplesWritten({ ...all, 'script-foreshadow': '  \n\t ' })).toBe(43)
    expect(examplesWritten({ 'graphics-worked-beat': 'something' })).toBe(0)
    expect(examplesWritten({ 'script-foreshadow': ' a line ' })).toBe(1)
  })
})

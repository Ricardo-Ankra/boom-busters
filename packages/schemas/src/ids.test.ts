import { describe, expect, it } from 'vitest'
import { UlidSchema, fixtureId, isUlid, newId, toId } from './ids'

describe('newId', () => {
  it('produces a valid 26-character ULID', () => {
    const id = newId<'project'>()
    expect(id).toHaveLength(26)
    expect(isUlid(id)).toBe(true)
  })

  it('produces unique, lexicographically sortable ids', () => {
    const ids = Array.from({ length: 200 }, () => newId<'project'>())
    expect(new Set(ids).size).toBe(200)
    expect([...ids].sort()).toEqual([...ids].sort((a, b) => a.localeCompare(b)))
  })
})

describe('toId', () => {
  it('accepts a well-formed ULID', () => {
    const raw = newId<'case'>()
    expect(toId<'case'>(raw)).toBe(raw)
  })

  it('rejects malformed input, including the ambiguous Crockford letters', () => {
    expect(() => toId('not-a-ulid')).toThrow()
    expect(() => toId('01ARZ3NDEKTSV4RRFFQ69G5FA')).toThrow() // 25 chars
    expect(() => toId('01ARZ3NDEKTSV4RRFFQ69G5FAVX')).toThrow() // 27 chars
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAI').success).toBe(false) // I
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAL').success).toBe(false) // L
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAO').success).toBe(false) // O
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAU').success).toBe(false) // U
  })
})

describe('fixtureId', () => {
  it('is deterministic, so seeds and golden tests stay stable', () => {
    expect(fixtureId('case', 1)).toBe(fixtureId('case', 1))
    expect(fixtureId('case', 1)).not.toBe(fixtureId('case', 2))
    expect(fixtureId('case', 1)).not.toBe(fixtureId('project', 1))
  })

  it('produces ids that pass ULID validation', () => {
    for (const slot of [0, 7, 42, 999]) {
      const id = fixtureId('project', slot)
      expect(id).toHaveLength(26)
      expect(isUlid(id)).toBe(true)
    }
  })

  it('strips characters that are not in the ULID alphabet', () => {
    expect(isUlid(fixtureId('shot-slot_1', 3))).toBe(true)
  })

  it('rejects an out-of-range slot', () => {
    expect(() => fixtureId('case', -1)).toThrow(RangeError)
    expect(() => fixtureId('case', 1000)).toThrow(RangeError)
    expect(() => fixtureId('case', 1.5)).toThrow(RangeError)
  })
})

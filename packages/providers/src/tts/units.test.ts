import { describe, expect, it } from 'vitest'
import { narrationUnits } from './units'

const chapters = [
  {
    id: 'c1',
    title: 'The audit',
    contentMd: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
  },
  { id: 'c2', title: 'The unwind', contentMd: 'Fourth paragraph.' },
]

describe('narrationUnits', () => {
  it('is one unit per paragraph — small units keep repairs cheap and re-runs free', () => {
    expect(narrationUnits({ chapters }).map((u) => [u.chapterId, u.unitIndex, u.text])).toEqual([
      ['c1', 0, 'First paragraph.'],
      ['c1', 1, 'Second paragraph.'],
      ['c1', 2, 'Third paragraph.'],
      ['c2', 0, 'Fourth paragraph.'],
    ])
  })

  it('produces nothing for an empty chapter rather than an empty unit', () => {
    expect(narrationUnits({ chapters: [{ id: 'c1', title: 'Empty', contentMd: '   ' }] })).toEqual(
      [],
    )
  })

  it('is deterministic — the unit text is what fingerprints are computed from', () => {
    expect(narrationUnits({ chapters })).toEqual(narrationUnits({ chapters }))
  })

  it('keeps indexes stable per chapter, which is what takes are addressed by', () => {
    const units = narrationUnits({ chapters })
    expect(units.filter((u) => u.chapterId === 'c2')[0]?.unitIndex).toBe(0)
  })
})

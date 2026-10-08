import { describe, expect, it } from 'vitest'
import type { GraphicScene } from '@boom-busters/schemas'
import { stillOf } from './live-graphic-still'

describe('stillOf (decision 290)', () => {
  it('reports the longest still stretch and how many words are spoken in it', () => {
    const scene: GraphicScene = {
      elements: [
        {
          kind: 'text',
          id: 't',
          cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
          content: 'Stability AI valuation',
          role: 'title',
          color: 'textSecondary',
          align: 'center',
          enter: { kind: 'fade', atMs: 2300 },
        },
      ],
    }
    const words = [{ offsetMs: 1000 }, { offsetMs: 5000 }, { offsetMs: 12_000 }]
    expect(stillOf(scene, 22_300, words)).toEqual({ fromMs: 2900, toMs: 22_300, words: 2 })
  })
})

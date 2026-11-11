import type { Timeline } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { segmentDurationMs } from './shorts-review'

const CHAPTER = '01HQ0000000000000000000CH1'

function masterWith(narration: Array<Record<string, unknown>>): Timeline {
  return { narration } as unknown as Timeline
}

describe('segmentDurationMs', () => {
  const ref = { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 1 }

  it('measures a plain window from first start to last end', () => {
    const master = masterWith([
      { chapterId: CHAPTER, paragraphIndex: 0, startMs: 0, durationMs: 8000 },
      { chapterId: CHAPTER, paragraphIndex: 1, startMs: 8700, durationMs: 6000 },
    ])
    expect(segmentDurationMs(master, ref)).toBe(14_700)
  })

  it('measures a split paragraph by its extent, not the sum of its pieces', () => {
    const master = masterWith([
      { chapterId: CHAPTER, paragraphIndex: 0, startMs: 0, durationMs: 8000 },
      { chapterId: CHAPTER, paragraphIndex: 1, startMs: 8700, durationMs: 3000 },
      {
        chapterId: CHAPTER,
        paragraphIndex: 1,
        startMs: 12_700,
        durationMs: 3000,
        trimStartMs: 3000,
      },
    ])
    expect(segmentDurationMs(master, ref)).toBe(15_700)
  })

  it('is null without a master or without narration in the window', () => {
    expect(segmentDurationMs(null, ref)).toBeNull()
    expect(segmentDurationMs(masterWith([]), ref)).toBeNull()
  })
})

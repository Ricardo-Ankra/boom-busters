import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { segmentInMaster, STALE_EXCERPT } from './short'

/**
 * Decision 300: whether the master still carries every paragraph a Short
 * references. An excerpt cut from an earlier script names chapter ids the
 * rebuilt master never had.
 */

const CHAPTER = '01HQ0000000000000000000CH1'

function master(paragraphs: number[]): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: paragraphs.map((index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 6000,
      durationMs: 6000,
      chapterId: CHAPTER,
      paragraphIndex: index,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [],
    overlays: [],
  }
}

describe('segmentInMaster', () => {
  it('is true when every referenced paragraph is in the master', () => {
    expect(
      segmentInMaster(master([0, 1, 2]), { chapterId: CHAPTER, fromParagraph: 1, toParagraph: 2 }),
    ).toBe(true)
  })

  it('is false for a chapter the master never had', () => {
    expect(
      segmentInMaster(master([0, 1, 2]), {
        chapterId: '01HQ0000000000000000000OLD',
        fromParagraph: 0,
        toParagraph: 0,
      }),
    ).toBe(false)
  })

  it('is false when one paragraph of the range is missing', () => {
    expect(
      segmentInMaster(master([0, 2]), { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 2 }),
    ).toBe(false)
  })

  it('is false for an inverted range', () => {
    expect(
      segmentInMaster(master([0, 1]), { chapterId: CHAPTER, fromParagraph: 1, toParagraph: 0 }),
    ).toBe(false)
  })

  it('tells the owner what to do about a stale excerpt', () => {
    expect(STALE_EXCERPT).toContain('cut from an earlier script')
    expect(STALE_EXCERPT).toContain('Run the Shorts stage again')
  })
})

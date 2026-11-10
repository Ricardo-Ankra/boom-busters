import { describe, expect, it } from 'vitest'
import type { Timeline } from '@boom-busters/schemas'
import { timelineChapters } from './preview-review'

/**
 * timelineChapters reads only narration, overlays and chapters, so the
 * fixtures carry just those and are cast to the full Timeline.
 */
function segment(chapterId: string, paragraphIndex: number, startMs: number, durationMs: number) {
  return {
    chapterId,
    paragraphIndex,
    startMs,
    durationMs,
    r2Key: `${chapterId}-${paragraphIndex}.mp3`,
  }
}

const narration = [
  segment('c1', 0, 0, 4000),
  segment('c1', 1, 4000, 3000),
  segment('c2', 0, 7000, 5000),
]

describe('timelineChapters', () => {
  it('titles chapters from the chapters list, so a cardless film keeps its names', () => {
    const timeline = {
      narration,
      overlays: [],
      chapters: [
        { id: 'c1', title: 'The audit' },
        { id: 'c2', title: 'The collapse' },
      ],
    } as unknown as Timeline
    const result = timelineChapters(timeline)
    expect(result.map((c) => c.title)).toEqual(['The audit', 'The collapse'])
    expect(result[1]?.startMs).toBe(timeline.narration[2]!.startMs)
  })

  it('falls back to the matching card, then to a positional name, for a timeline without the list', () => {
    const timeline = {
      narration,
      overlays: [
        {
          kind: 'chapterCard',
          startMs: 6500,
          durationMs: 500,
          props: { index: 2, title: 'The collapse' },
        },
      ],
    } as unknown as Timeline
    expect(timelineChapters(timeline).map((c) => c.title)).toEqual(['Chapter 1', 'The collapse'])
  })
})

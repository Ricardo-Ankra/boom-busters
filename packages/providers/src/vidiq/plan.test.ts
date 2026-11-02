import type { BibleDraftInputs } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  channelRefFromInput,
  estimateResearchCredits,
  planResearch,
  transcriptOpening,
  videoIdFromUrl,
} from './plan'
import type { ResearchPlan } from './plan'

const inputs: BibleDraftInputs = {
  description: 'Business collapse documentaries',
  audience: '',
  admiredChannels: [],
  videos: [],
  avoid: '',
}
const own = { handle: '@own', language: 'en' }

describe('the research plan', () => {
  it('links and ids resolve, junk is named', () => {
    expect(videoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ')
    expect(videoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(videoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=9')).toBe('dQw4w9WgXcQ')
    expect(videoIdFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(videoIdFromUrl('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(videoIdFromUrl('https://vimeo.com/123')).toBeNull()
    expect(channelRefFromInput('https://www.youtube.com/@SomeChannel/videos')).toBe('@SomeChannel')
    expect(channelRefFromInput('@handle')).toBe('@handle')
    expect(channelRefFromInput('https://www.youtube.com/channel/UCzgd02HrspamnkL-6sW8BDQ')).toBe(
      'UCzgd02HrspamnkL-6sW8BDQ',
    )
    expect(channelRefFromInput('https://vimeo.com/x')).toBeNull()
    expect(planResearch({ ...inputs, videos: ['https://vimeo.com/123'] }, own)).toEqual({
      error: 'Not a YouTube video link: https://vimeo.com/123',
    })
    expect(planResearch({ ...inputs, admiredChannels: ['some words'] }, own)).toEqual({
      error: 'Not a YouTube channel: some words',
    })
  })

  it('puts the own channel first and drops repeats', () => {
    const plan = planResearch(
      { ...inputs, admiredChannels: ['@a', '@OWN'], videos: ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'] },
      own,
    ) as ResearchPlan
    expect(plan.channels).toEqual([
      { ref: '@own', own: true },
      { ref: '@a', own: false },
    ])
    expect(plan.videoIds).toEqual(['dQw4w9WgXcQ'])
    expect(plan.language).toBe('en')
  })

  it('the estimate counts every call the run will make', () => {
    const plan = planResearch(
      { ...inputs, admiredChannels: ['@a', '@b'], videos: ['dQw4w9WgXcQ'] },
      own,
    )
    expect(estimateResearchCredits(plan as ResearchPlan)).toBe(5 * (3 + 1 + 1 + 4))
  })

  it('the transcript opening stops at sixty seconds', () => {
    expect(
      transcriptOpening({
        segments: [
          { start: 0, text: 'a' },
          { start: 59, text: 'b' },
          { start: 61, text: 'c' },
        ],
      }),
    ).toBe('a b')
    expect(transcriptOpening({ segments: [{ start: null, text: 'x'.repeat(2000) }] })).toHaveLength(
      900,
    )
  })
})

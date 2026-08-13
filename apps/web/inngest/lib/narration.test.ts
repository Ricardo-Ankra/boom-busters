import { takeIdempotencyKey } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  chunk,
  paragraphJobs,
  TTS_CONCURRENCY,
  ttsConcurrency,
  withinFailureTolerance,
} from './narration'

const projectId = '01HQ0000000000000000000001'

const chapters = [
  { id: 'c1', title: 'The audit', contentMd: 'First paragraph.\n\nSecond paragraph.' },
  { id: 'c2', title: 'The unwind', contentMd: 'Third paragraph.' },
]

describe('paragraphJobs', () => {
  it('flattens the script into paragraphs in speaking order', () => {
    const jobs = paragraphJobs({ projectId, voiceId: 'Charon', chapters })

    expect(jobs.map((job) => [job.chapterId, job.paragraphIndex, job.text])).toEqual([
      ['c1', 0, 'First paragraph.'],
      ['c1', 1, 'Second paragraph.'],
      ['c2', 0, 'Third paragraph.'],
    ])
  })

  it('numbers paragraphs within a chapter, not across the script', () => {
    // `(chapterId, paragraphIndex)` addresses a take, a retake, an alignment
    // merge and a Shorts segment ref. A global counter would renumber every
    // paragraph after a chapter that gained one.
    const jobs = paragraphJobs({ projectId, voiceId: 'Charon', chapters })
    expect(jobs.filter((job) => job.chapterId === 'c2')[0]?.paragraphIndex).toBe(0)
  })

  it('gives every paragraph the key the runner will look it up by', () => {
    const [first] = paragraphJobs({ projectId, voiceId: 'Charon', chapters })

    expect(first?.idempotencyKey).toBe(
      takeIdempotencyKey({
        projectId,
        chapterId: 'c1',
        paragraphIndex: 0,
        text: 'First paragraph.',
        voiceId: 'Charon',
      }),
    )
  })

  it('changes the key when the voice changes, so a new narrator re-reads', () => {
    const a = paragraphJobs({ projectId, voiceId: 'Charon', chapters })[0]?.idempotencyKey
    const b = paragraphJobs({ projectId, voiceId: 'Kore', chapters })[0]?.idempotencyKey
    expect(a).not.toBe(b)
  })

  it('changes the key when pacing moves off 1×, so a speed change re-reads', () => {
    const at1 = paragraphJobs({ projectId, voiceId: 'Charon', chapters })[0]?.idempotencyKey
    const slower = paragraphJobs({ projectId, voiceId: 'Charon', chapters, pacing: 0.9 })[0]
      ?.idempotencyKey

    expect(slower).not.toBe(at1)
    // And the default explicit is the default absent, so takes bought before
    // pacing joined the key are still recognised and not re-bought.
    expect(paragraphJobs({ projectId, voiceId: 'Charon', chapters, pacing: 1 })[0]?.idempotencyKey).toBe(
      at1,
    )
  })

  it('leaves untouched paragraphs with untouched keys when one is edited', () => {
    // This is what makes a re-run after a small edit cost one paragraph rather
    // than sixty.
    const before = paragraphJobs({ projectId, voiceId: 'Charon', chapters })
    const after = paragraphJobs({
      projectId,
      voiceId: 'Charon',
      chapters: [
        { ...chapters[0]!, contentMd: 'First paragraph.\n\nSecond paragraph, revised.' },
        chapters[1]!,
      ],
    })

    expect(after[0]?.idempotencyKey).toBe(before[0]?.idempotencyKey)
    expect(after[2]?.idempotencyKey).toBe(before[2]?.idempotencyKey)
    expect(after[1]?.idempotencyKey).not.toBe(before[1]?.idempotencyKey)
  })

  it('produces nothing for a script of empty chapters', () => {
    expect(
      paragraphJobs({
        projectId,
        voiceId: 'Charon',
        chapters: [{ id: 'c', title: 'x', contentMd: '   ' }],
      }),
    ).toEqual([])
  })
})

describe('withinFailureTolerance', () => {
  it('accepts up to 15% of items failing, which is the spec figure', () => {
    expect(withinFailureTolerance(3, 20)).toBe(true)
    expect(withinFailureTolerance(4, 20)).toBe(false)
  })

  it('accepts a clean run', () => {
    expect(withinFailureTolerance(0, 60)).toBe(true)
  })

  /**
   * A single-paragraph script has no tolerance at all: one failure is 100%.
   * That is the right answer — there is nothing to review.
   */
  it('fails a one-paragraph script whose only paragraph failed', () => {
    expect(withinFailureTolerance(1, 1)).toBe(false)
  })

  it('is false for no items, rather than vacuously true', () => {
    expect(withinFailureTolerance(0, 0)).toBe(false)
  })
})

describe('ttsConcurrency', () => {
  it('goes gentler on Gemini, whose preview TTS models have single-digit RPM caps', () => {
    expect(ttsConcurrency('gemini')).toBe(2)
    expect(ttsConcurrency('elevenlabs')).toBe(TTS_CONCURRENCY)
    expect(ttsConcurrency('google-cloud-tts')).toBe(TTS_CONCURRENCY)
  })
})

describe('chunk', () => {
  it('bounds how many syntheses are in flight at once', () => {
    const items = Array.from({ length: 12 }, (_, index) => index)
    const batches = chunk(items, TTS_CONCURRENCY)

    expect(batches.map((batch) => batch.length)).toEqual([5, 5, 2])
    expect(batches.flat()).toEqual(items)
  })

  it('handles fewer items than a batch', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]])
  })

  it('handles nothing', () => {
    expect(chunk([], 5)).toEqual([])
  })
})

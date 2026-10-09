import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { planChapterWith } from './plan-chapter'

const chapter = { id: 'ch1', title: 'The fall', number: 1 }
const paragraphs = [
  {
    chapterId: 'ch1',
    index: 0,
    text: 'The board met in the glass room.',
    seconds: 8,
    startMs: 0,
    durationMs: 8000,
  },
]
const input = {
  caseTitle: 'Case',
  chapter,
  paragraphs: paragraphs as never,
  claims: [],
  direction: null,
}
const oneStill = JSON.stringify({
  slots: [
    {
      paragraphIndex: 0,
      seconds: 8,
      brief: {
        type: 'still',
        coversText: 'The board met in the glass room.',
        description: 'The board at the table.',
        shotSize: 'wide',
        motion: { kind: 'static' },
        transition: 'cut',
        prompt: 'Four directors at a long table, dusk light from the windows. 24mm, eye level.',
      },
    },
  ],
})

describe('planChapterWith', () => {
  it('plans a chapter through the injected completion', async () => {
    const complete = vi.fn().mockResolvedValue({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'shotlist' }), 'plan')
  })

  it('doubles the budget once when the answer is cut off', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"slots": [{"paragraphIndex": 0,' })
      .mockResolvedValueOnce({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete.mock.calls[1]?.[1]).toBe('retry: cut off')
    expect(complete.mock.calls[1]?.[0].maxTokens).toBeGreaterThan(
      complete.mock.calls[0]?.[0].maxTokens,
    )
  })

  it('asks once more with the reason when the plan is refused (decision 292)', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'no json here' })
      .mockResolvedValueOnce({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete.mock.calls[1]?.[1]).toBe('retry: refused')
    expect(complete.mock.calls[1]?.[0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: /,
    )
  })

  it('stops the chapter after two refusals, with a stop Inngest will not retry', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'no json here' })
    const planning = planChapterWith(complete, input)
    await expect(planning).rejects.toBeInstanceOf(NonRetriableError)
    await expect(planChapterWith(complete, input)).rejects.toThrow(
      /^Chapter 1 could not be planned: /,
    )
    expect(complete).toHaveBeenCalledTimes(4)
  })

  it('returns null for a chapter with no narration', async () => {
    const complete = vi.fn()
    expect(await planChapterWith(complete, { ...input, paragraphs: [] })).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it('keeps the plan when the repair call fails', async () => {
    const banned = oneStill.replace('Four directors', 'Four cinematic directors')
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: banned })
      .mockRejectedValueOnce(new ValidationError('down'))
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
  })
})

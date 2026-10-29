import { describe, expect, it, vi } from 'vitest'
import type { LLMTaskRequest } from '@boom-busters/providers'
import { BudgetExceededError, FIRST_CHANNEL_IN_USE, ValidationError } from '@boom-busters/schemas'
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
    words: [],
  },
]
const input = {
  bible: FIRST_CHANNEL_IN_USE,
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

describe('planChapterWith, the automatic timing repair (the stretch re-plan design, 3.2)', () => {
  // The Theranos pair: a headline quoting the whole paragraph, then a stock
  // shot quoting its second sentence, so the headline is on screen for 2 s
  // and both shots quote the CNBC line.
  const TEXT =
    'Other tallies went higher. In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.'
  const SECOND = 'In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.'
  const tokens = TEXT.split(' ')
  const timed = {
    chapterId: 'ch1',
    index: 0,
    text: TEXT,
    startMs: 0,
    durationMs: tokens.length * 500,
    words: tokens.map((text, i) => ({ text, startMs: i * 500 })),
  }
  const news = {
    id: 'claim-cnbc',
    text: 'CNBC reported that Holmes raised 945 million.',
    sourceUrl: 'https://www.cnbc.com/2021/09/08/theranos-trial-investors.html',
    confidence: 'high',
    sourceType: 'major_outlet',
  }
  const theranosInput = { ...input, paragraphs: [timed], claims: [news] }
  const headline = (coversText: string, seconds: number) => ({
    paragraphIndex: 0,
    seconds,
    brief: {
      type: 'headline',
      coversText,
      description: 'The CNBC report on the morning it ran.',
      shotSize: 'graphic',
      motion: { kind: 'static' },
      transition: 'cut',
      sourceRef: 1,
    },
  })
  const stock = (coversText: string, seconds: number) => ({
    paragraphIndex: 0,
    seconds,
    brief: {
      type: 'stock',
      coversText,
      description: 'An empty open-plan office at dusk, desks cleared.',
      shotSize: 'wide',
      motion: { kind: 'static' },
      transition: 'cut',
      query: 'empty office dusk',
      rejectionCriteria: ['no watermarks'],
    },
  })
  const pair = JSON.stringify({ slots: [headline(TEXT, 2), stock(SECOND, 6.5)] })
  const whole = JSON.stringify({ slots: [headline(TEXT, 8.5)] })

  function scripted(...texts: string[]) {
    const purposes: string[] = []
    const requests: LLMTaskRequest[] = []
    const complete = vi.fn(async (request: LLMTaskRequest, purpose: string) => {
      purposes.push(purpose)
      requests.push(request)
      return { text: texts[Math.min(purposes.length - 1, texts.length - 1)]! }
    })
    return { complete, purposes, requests }
  }

  it('re-plans the Theranos pair once after planning', async () => {
    const { complete: scriptedComplete, purposes, requests } = scripted(pair, whole)
    const planned = await planChapterWith(scriptedComplete, theranosInput)
    expect(planned!.slots.map((s) => s.brief.type)).toEqual(['headline'])
    expect(purposes).toEqual(['plan', 'stretch'])
    const asked = requests[1]!.messages.at(-1)!.content
    expect(asked).toContain(
      'Why: this news headline is on screen for 2.0 s; it needs at least 5 s; this shot and the next both quote',
    )
  })

  it('judges the repair among the shots outside it', async () => {
    // The first shot is short; the repair's answer ends on "that Holmes",
    // which is short only because the third planned shot starts right after.
    const planned = JSON.stringify({
      slots: [
        stock('Other tallies', 1),
        stock('went higher. In 2021, CNBC reported that Holmes', 4),
        stock('persuaded investors to put up 945 million.', 3.5),
      ],
    })
    const short = JSON.stringify({
      slots: [
        stock('Other tallies went higher. In 2021, CNBC reported', 4),
        stock('that Holmes', 1),
      ],
    })
    const joined = JSON.stringify({
      slots: [stock('Other tallies went higher. In 2021, CNBC reported that Holmes', 5)],
    })
    // Answered by purpose: the craft repair may run between plan and stretch.
    const byPurpose: Record<string, string> = {
      plan: planned,
      repair: '{"briefs": []}',
      stretch: short,
      'retry: refused': joined,
    }
    const purposes: string[] = []
    const complete = vi.fn(async (_request: LLMTaskRequest, purpose: string) => {
      purposes.push(purpose)
      return { text: byPurpose[purpose] ?? '' }
    })
    const result = await planChapterWith(complete, theranosInput)
    expect(purposes.filter((purpose) => purpose !== 'repair')).toEqual([
      'plan',
      'stretch',
      'retry: refused',
    ])
    expect(result!.slots.map((s) => s.brief.coversText)).toEqual([
      'Other tallies went higher. In 2021, CNBC reported that Holmes',
      'persuaded investors to put up 945 million.',
    ])
  })

  it('keeps the planned slots when the timing repair stops', async () => {
    const { complete, purposes } = scripted(pair, 'no json here')
    const planned = await planChapterWith(complete, theranosInput)
    expect(planned!.slots.map((s) => s.brief.type)).toEqual(['headline', 'stock'])
    expect(purposes).toEqual(['plan', 'stretch', 'retry: refused'])
  })

  it('makes no extra call for a chapter with no timing finding', async () => {
    const { complete, purposes } = scripted(whole)
    const planned = await planChapterWith(complete, theranosInput)
    expect(planned!.slots).toHaveLength(1)
    expect(purposes).toEqual(['plan'])
  })

  it('skips the repair for narration without word timings', async () => {
    const { complete, purposes } = scripted(pair)
    const planned = await planChapterWith(complete, {
      ...theranosInput,
      paragraphs: [{ ...timed, words: [] }],
    })
    expect(planned!.slots.map((s) => s.brief.type)).toEqual(['headline', 'stock'])
    expect(purposes).toEqual(['plan'])
  })

  it('keeps the plan when the repair hits the budget', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: pair })
      .mockRejectedValueOnce(
        new BudgetExceededError({
          provider: 'google',
          operation: 'llm.shotlist',
          budgetUsd: 30,
          monthSpendUsd: 30,
          estimateUsd: 0.01,
        }),
      )
    const planned = await planChapterWith(complete, theranosInput)
    expect(planned!.slots.map((s) => s.brief.type)).toEqual(['headline', 'stock'])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError, GraphicBriefSchema, ValidationError } from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
let mock = false
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  mockProvidersEnabled: () => mock,
}))

import {
  designGraphic,
  designGraphicWith,
  designIssueText,
  GRAPHIC_DESIGN_DEADLINE_MS,
  withDesign,
  type GraphicDesignContext,
} from './graphic-design'

const A = '01J00000000000000000000001'
const CONTEXT: GraphicDesignContext = {
  projectId: '01J0000000000000000000000P',
  caseTitle: 'Acme',
  claims: [{ id: A, text: 'Acme raised 4 billion dollars.', sourceUrl: null, confidence: 'high' }],
  logos: [],
  paragraphs: [
    {
      chapterId: 'c1',
      index: 0,
      text: 'Acme raised four billion.',
      startMs: 0,
      durationMs: 6000,
      words: [{ text: 'four', startMs: 900 }],
    },
  ],
  chapterTitle: 'The raise',
}
const BRIEF = {
  type: 'graphic' as const,
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' as const },
  transition: 'cut' as const,
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const SLOT = { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: BRIEF }
const answer = (value: string, atMs = 900) => ({
  text: JSON.stringify({
    scene: {
      elements: [
        {
          kind: 'figure',
          id: 'f',
          cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
          value,
          claimRef: 1,
          color: 'accent',
          enter: { kind: 'count', atMs },
        },
      ],
    },
  }),
})

beforeEach(() => {
  callLlm.mockReset()
  mock = false
})

afterEach(() => {
  vi.useRealTimers()
})

const CUT_OFF = "the designer's answer was cut off at its length limit"
const TOO_LONG = 'the designer took too long; press Redesign graphic to try again'

describe('designGraphic (decision 289)', () => {
  it('stores a scene that passes, with claim ids', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, scene: { elements: [{ claimRef: A }] } })
    expect(callLlm.mock.calls[0]![0].messages[1].content).toContain('0.9 s  four')
  })

  it('asks once more with the reason, and takes the second answer', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    )
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
  })

  it('gives up after the second refusal, with the reason', async () => {
    callLlm.mockResolvedValue(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('refuses an entrance that cannot finish inside the slot', async () => {
    callLlm.mockResolvedValue(answer('$4bn', 5800))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toEqual({
      ok: false,
      issue: expect.stringMatching(/^element "f" enters at 5800 ms/),
    })
  })

  it('retries a cut-off answer once at double the budget', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
  })

  it('refuses an exit that cannot finish inside the slot, and retries with the reason (decision 290)', async () => {
    const leaving = {
      text: JSON.stringify({
        scene: {
          elements: [
            {
              kind: 'figure',
              id: 'f',
              cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
              value: '$4bn',
              claimRef: 1,
              color: 'accent',
              enter: { kind: 'count', atMs: 900 },
            },
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
              content: 'Raised',
              role: 'title',
              color: 'textSecondary',
              enter: { kind: 'fade', atMs: 0 },
              exit: { kind: 'fade', atMs: 5800 },
            },
          ],
        },
      }),
    }
    callLlm.mockResolvedValueOnce(leaving).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'element "t" leaves at 5800 ms, but this 6.0 s slot needs its exit to start by 5500 ms',
    )
  })

  it('reports an answer cut off twice as a design issue, without a reason-retry', async () => {
    callLlm.mockRejectedValue(new ValidationError('cut off', { field: 'maxTokens' }))
    await expect(designGraphic(CONTEXT, SLOT)).resolves.toEqual({ ok: false, issue: CUT_OFF })
    // The first try and its doubled retry; a third call at the doubled
    // budget would be cut off again (final review I2).
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries an answer cut off mid-JSON at double the budget', async () => {
    callLlm
      .mockResolvedValueOnce({ text: '{"scene": {"elements": [', truncated: true })
      .mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
    // The doubled call is the same request, not a reason-retry.
    expect(callLlm.mock.calls[1]![0].messages).toEqual(callLlm.mock.calls[0]![0].messages)
  })

  it('ends the design at once when the doubled answer is cut off mid-JSON too', async () => {
    callLlm.mockResolvedValue({ text: '{"scene": {"elements": [', truncated: true })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the retry after a refusal is cut off (decision 292)', async () => {
    callLlm
      .mockResolvedValueOnce(answer('$5bn'))
      .mockResolvedValueOnce({ text: '{"scene": {"elements": [', truncated: true })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the doubled answer is refused (decision 292)', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('gives every call a signal that aborts at the design deadline', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[0]![1]).toMatchObject({
      projectId: CONTEXT.projectId,
      signal: expect.any(AbortSignal),
    })
  })

  it('reports a call that fails after the deadline as too long, without throwing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS + 1)
      throw new Error('This operation was aborted')
    })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: TOO_LONG })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('does not start a second attempt with under 15 s left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS - 14_000)
      return answer('$5bn')
    })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: TOO_LONG })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('lets a budget stop through even past the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS + 1)
      throw new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 10,
        monthSpendUsd: 10,
        estimateUsd: 0.1,
      })
    })
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('lets a failure inside the deadline through', async () => {
    callLlm.mockRejectedValue(new Error('provider down'))
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toThrow('provider down')
  })

  it('lets any other ValidationError from the call through', async () => {
    callLlm.mockRejectedValue(
      new ValidationError('anthropic rejected the API key (401).', {
        field: 'connections.anthropic',
      }),
    )
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toThrow('rejected the API key')
  })

  it('shows a redesign the current scene in claim numbers, then the steer last', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const designed = await designGraphic(CONTEXT, SLOT)
    if (!designed.ok) throw new Error('setup design failed')
    callLlm.mockReset()
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(
      CONTEXT,
      { ...SLOT, brief: { ...BRIEF, scene: designed.scene } },
      { redesign: true, guidance: 'Make the number bigger.' },
    )
    const messages = callLlm.mock.calls[0]![0].messages as { content: string }[]
    const current = messages.find((m) => m.content.startsWith('The current design'))
    expect(current?.content).toContain('"claimRef": 1')
    expect(messages.at(-1)!.content).toBe("The producer's steer: Make the number bigger.")
  })

  it('designs from the description when the graphic predates intents', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const { intent: _i, intentClaimIds: _c, ...legacy } = BRIEF
    await designGraphic(CONTEXT, { ...SLOT, brief: legacy })
    expect(callLlm.mock.calls[0]![0].messages[1].content).toContain('Intent: The figure.')
  })

  it('makes no call in mock mode', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('designs a long slot in two steps in mock mode, through the same checks (decision 290)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, durationMs: 12_000 })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      scene: { camera: [{ atMs: 6500, focus: 'f1', zoom: 1.2 }] },
    })
  })
})

describe('withDesign', () => {
  it('stores the scene and clears any old issue', () => {
    const designed = withDesign(
      { ...BRIEF, designIssue: 'old' },
      { ok: true, scene: { elements: [] } as never },
    )
    expect(designed.designIssue).toBeUndefined()
    expect(designed.scene).toEqual({ elements: [] })
  })

  it('stores the issue without a scene', () => {
    expect(withDesign(BRIEF, { ok: false, issue: 'why' })).toEqual({ ...BRIEF, designIssue: 'why' })
  })

  it('caps an overlong issue so the stored brief still parses (final review I1)', () => {
    const issue = `The graphic is malformed: ${'elements.0.cell: too wide; '.repeat(40)}`.slice(
      0,
      900,
    )
    expect(issue).toHaveLength(900)
    const designed = withDesign(BRIEF, { ok: false, issue })
    const parsed = GraphicBriefSchema.parse(designed)
    expect(parsed.designIssue!.length).toBeLessThanOrEqual(500)
    expect(parsed.designIssue!.endsWith('…')).toBe(true)
    expect(issue.startsWith(parsed.designIssue!.slice(0, -1))).toBe(true)
  })
})

describe('designGraphicWith (the way in for the live harness)', () => {
  it('designs through the function it is given, handing it the request and a signal, and never touches callLlm', async () => {
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, scene: { elements: [{ claimRef: A }] } })
    expect(complete).toHaveBeenCalledTimes(1)
    const [request, options] = complete.mock.calls[0]!
    expect(request.messages[1].content).toContain('0.9 s  four')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('keeps the cut-off doubling of the app path, and stops at two calls (decision 292)', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result.ok).toBe(false)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].maxTokens).toBe(complete.mock.calls[0]![0].maxTokens * 2)
    expect(complete.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: cut off' })
  })

  it('keeps the reason-retry of the app path', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(answer('$5bn'))
      .mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(complete.mock.calls[1]![0].messages.at(-1).content).toContain('$5bn')
    expect(complete.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
  })
})

describe('designIssueText', () => {
  it('leaves a short issue as it is, trimmed', () => {
    expect(designIssueText('  why  ')).toBe('why')
  })

  it('cuts at a word boundary and marks the cut', () => {
    const text = designIssueText(`${'word '.repeat(180)}`)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toMatch(/word…$/)
  })

  it('cuts a 900-character issue to at most 500', () => {
    const text = designIssueText('x'.repeat(900))
    expect(text.length).toBe(500)
    expect(text.endsWith('…')).toBe(true)
  })
})

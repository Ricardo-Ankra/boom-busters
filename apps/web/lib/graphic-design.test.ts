import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
let mock = false
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  mockProvidersEnabled: () => mock,
}))

import { designGraphic, withDesign, type GraphicDesignContext } from './graphic-design'

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

  it('reports an answer cut off twice as a design issue, without throwing', async () => {
    callLlm.mockRejectedValue(new ValidationError('cut off', { field: 'maxTokens' }))
    await expect(designGraphic(CONTEXT, SLOT)).resolves.toEqual({
      ok: false,
      issue: "the designer's answer was cut off at its length limit",
    })
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
})

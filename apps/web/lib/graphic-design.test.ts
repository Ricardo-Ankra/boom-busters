// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BudgetExceededError,
  ChartBriefSchema,
  GraphicBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  ChartBrief,
  GraphicBrief,
  GraphicCode,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
let mock = false
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  mockProvidersEnabled: () => mock,
}))

import { graphicCodeIssue } from './graphic-code/check'
import { slotIntent } from './graphic-design-core'
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
const BRIEF: GraphicBrief = {
  type: 'graphic',
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' },
  transition: 'cut',
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const CHART: ChartBrief = {
  type: 'chart',
  coversText: 'Acme raised four billion.',
  description: 'The raise, drawn.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'bar',
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  dataRefs: [A],
  takeaway: 'Four billion in a year.',
  reveal: 'draw-on',
}
const SLOT = { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: BRIEF }
/** The slot's words as the code reads them: "four" at 0.9 s. */
const WORDS = [{ text: 'four', atMs: 900 }]

/**
 * A title over a figure that lands as "four" is said, with a slow drift so no
 * stretch of the slot is still. `value` is the figure on screen.
 */
const figureSource = (value: string) => `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { durationInFrames } = Remotion.useVideoConfig()
  const land = Remotion.interpolate(frame, [27, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drift = Remotion.interpolate(frame, [0, durationInFrames], [1, 1.04])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: props.brand.colors.background, transform: 'scale(' + drift + ')' }}>
      <div style={{ color: props.brand.colors.textSecondary, fontFamily: props.brand.fonts.title, fontSize: 56 }}>Raised in one round</div>
      <div style={{ opacity: land, color: props.brand.colors.accent, fontFamily: props.brand.fonts.numbers, fontSize: 220 }}>${value}</div>
    </div>
  )
}`

const planned = (value: string): PlannedGraphicCode => ({
  source: figureSource(value),
  title: 'Raised in one round',
  facts: [{ text: '4 billion', claim: 1 }],
})
const answer = (value: string) => ({ text: JSON.stringify(planned(value)) })

/** A component that throws once the reveal comes. */
const THROWS: PlannedGraphicCode = {
  source: `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  if (frame >= 40) throw new Error('boom at the reveal')
  return <div style={{ color: props.brand.colors.textPrimary }}>Raised</div>
}`,
  title: 'Raised',
  facts: [],
}

/** A component esbuild cannot compile. */
const BROKEN: PlannedGraphicCode = {
  source: 'function Graphic(props) { return <div>Raised</ }',
  title: 'Raised',
  facts: [],
}

/** An answer cut off mid-JSON. */
const HALF = { text: '{"source": "function Graphic(props) {', truncated: true }

/**
 * The refusal the checks give a design in this slot, worded as the checks
 * word it: the retry and the stored issue carry exactly this.
 */
function issueOf(design: PlannedGraphicCode): string {
  const checked = graphicCodeIssue(design, CONTEXT, {
    brief: BRIEF,
    durationMs: 6000,
    words: WORDS,
  })
  if ('code' in checked) throw new Error('expected the checks to refuse this design')
  return checked.issue
}

/** Every message one call sent, as one text, however the prompt splits it. */
const sent = (call = 0) =>
  (callLlm.mock.calls[call]![0].messages as { content: string }[])
    .map((message) => message.content)
    .join('\n\n')

/** A stored design, for the redesign and `withDesign` tests. */
const CODE: GraphicCode = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'function Graphic() {\n  return null;\n}\n',
  title: 'Raised in one round',
  facts: [{ text: '4 billion', claimId: A }],
  words: WORDS,
  durationMs: 6000,
}

beforeEach(() => {
  callLlm.mockReset()
  mock = false
})

afterEach(() => {
  vi.useRealTimers()
})

const CUT_OFF = "the designer's answer was cut off at its length limit"
const TOO_LONG = 'the designer took too long; press Redesign graphic to try again'

describe('designGraphic (decisions 289, 295)', () => {
  it('stores code that passes every check, compiled, its facts on claim ids and its words on the slot clock', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toMatchObject({
      ok: true,
      code: {
        version: 1,
        source: figureSource('$4bn'),
        title: 'Raised in one round',
        facts: [{ text: '4 billion', claimId: A }],
        words: WORDS,
        durationMs: 6000,
      },
    })
    if (!result.ok) throw new Error('unreachable')
    // Plain JavaScript: the JSX is compiled away, so the sandbox builds it as it is.
    expect(result.code.compiled).not.toContain('<div')
    expect(sent()).toContain('four')
  })

  it('asks once more with the reason, and takes the second answer', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(issueOf(planned('$5bn')))
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
  })

  it('gives up after the second refusal, with the reason', async () => {
    callLlm.mockResolvedValue(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: issueOf(planned('$5bn')),
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('refuses code that throws while it plays, naming the error (decision 295)', async () => {
    callLlm.mockResolvedValue({ text: JSON.stringify(THROWS) })
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toEqual({ ok: false, issue: issueOf(THROWS) })
    expect(result.ok ? '' : result.issue).toContain('boom at the reveal')
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries a cut-off answer once at double the budget', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
  })

  it('refuses code that does not compile, and retries with the reason (decision 295)', async () => {
    callLlm
      .mockResolvedValueOnce({ text: JSON.stringify(BROKEN) })
      .mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(issueOf(BROKEN))
  })

  it('reports an answer cut off twice as a design issue, without a reason-retry', async () => {
    callLlm.mockRejectedValue(new ValidationError('cut off', { field: 'maxTokens' }))
    await expect(designGraphic(CONTEXT, SLOT)).resolves.toEqual({ ok: false, issue: CUT_OFF })
    // The first try and its doubled retry; a third call at the doubled
    // budget would be cut off again (final review I2).
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries an answer cut off mid-JSON at double the budget', async () => {
    callLlm.mockResolvedValueOnce(HALF).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
    // The doubled call is the same request, not a reason-retry.
    expect(callLlm.mock.calls[1]![0].messages).toEqual(callLlm.mock.calls[0]![0].messages)
  })

  it('ends the design at once when the doubled answer is cut off mid-JSON too', async () => {
    callLlm.mockResolvedValue(HALF)
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the retry after a refusal is cut off (decision 292)', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(HALF)
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the doubled answer is refused (decision 292)', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: issueOf(planned('$5bn')),
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

  it('shows a redesign the current code, then the steer last', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const designed = await designGraphic(CONTEXT, SLOT)
    if (!designed.ok) throw new Error('setup design failed')
    callLlm.mockReset()
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(
      CONTEXT,
      { ...SLOT, brief: { ...BRIEF, code: designed.code } },
      { redesign: true, guidance: 'Make the number bigger.' },
    )
    // The component being replaced reaches the model; `fontSize: 220` is in its source only.
    expect(sent()).toContain('fontSize: 220')
    const messages = callLlm.mock.calls[0]![0].messages as { content: string }[]
    expect(messages.at(-1)!.content).toBe("The producer's steer: Make the number bigger.")
  })

  it('designs from the description when the graphic predates intents', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const { intent: _i, intentClaimIds: _c, ...legacy } = BRIEF
    await designGraphic(CONTEXT, { ...SLOT, brief: legacy })
    expect(sent()).toContain('The figure.')
  })

  it('sends a chart its series and takeaway, and stores the code (decision 295)', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, { ...SLOT, brief: CHART })
    expect(result).toMatchObject({
      ok: true,
      code: { title: 'Raised in one round', facts: [{ claimId: A }] },
    })
    expect(sent()).toContain('Four billion in a year.')
    expect(sent()).toContain('USD bn')
  })

  it('makes no call in mock mode, and the fixture passes every check (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, SLOT)
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      code: { version: 1, title: expect.stringMatching(/^\[mock\]/) },
    })
    if (!result.ok) throw new Error('unreachable')
    expect(typeof result.code.compiled).toBe('string')
    // The mock's figure cites the claim the intent rests on.
    expect(result.code.facts).toContainEqual(expect.objectContaining({ claimId: A }))
  })

  it('designs a 12 s slot in mock mode, through the same dead-air check (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, durationMs: 12_000 })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, code: { durationMs: 12_000 } })
  })

  it('designs a chart in mock mode around its series (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, brief: CHART })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})

describe('slotIntent', () => {
  it('designs a graphic from its intent and the claims it names', () => {
    expect(slotIntent(CONTEXT, BRIEF)).toEqual({
      intent: 'Four billion is the story.',
      intentRefs: [1],
    })
  })

  it('designs a chart from its takeaway, resting on its data refs (decision 295)', () => {
    expect(slotIntent(CONTEXT, CHART)).toEqual({
      intent: 'Four billion in a year.',
      intentRefs: [1],
    })
  })

  it('drops a data ref the claim list no longer holds', () => {
    expect(
      slotIntent(CONTEXT, { ...CHART, dataRefs: ['01J0000000000000000000000Z'] }).intentRefs,
    ).toEqual([])
  })
})

describe('withDesign', () => {
  it('stores the code and clears any old issue', () => {
    const designed = withDesign({ ...BRIEF, designIssue: 'old' }, { ok: true, code: CODE })
    expect(designed.designIssue).toBeUndefined()
    expect(designed.code).toEqual(CODE)
  })

  it('stores the issue without code', () => {
    expect(withDesign(BRIEF, { ok: false, issue: 'why' })).toEqual({ ...BRIEF, designIssue: 'why' })
  })

  it('keeps the code a refused redesign would have replaced (decision 295)', () => {
    const kept = withDesign({ ...BRIEF, code: CODE }, { ok: false, issue: 'why' })
    expect(kept.code).toEqual(CODE)
    expect(kept.designIssue).toBe('why')
  })

  it("stores a chart's code on the chart, which still parses as one (decision 295)", () => {
    const designed = ChartBriefSchema.parse(withDesign(CHART, { ok: true, code: CODE }))
    expect(designed).toMatchObject({ type: 'chart', series: CHART.series, code: CODE })
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

describe('designGraphicWith (the model call is injected)', () => {
  it('designs through the function it is given, handing it the request and a signal, and never touches callLlm', async () => {
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, code: { facts: [{ claimId: A }] } })
    expect(complete).toHaveBeenCalledTimes(1)
    const [request, options] = complete.mock.calls[0]!
    expect(
      (request.messages as { content: string }[]).map((message) => message.content).join('\n\n'),
    ).toContain('four')
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
    expect(complete.mock.calls[1]![0].messages.at(-1).content).toContain(issueOf(planned('$5bn')))
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

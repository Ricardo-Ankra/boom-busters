// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BudgetExceededError,
  ChartBriefSchema,
  FIRST_CHANNEL_IN_USE,
  GraphicBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  ChartBrief,
  GraphicBrief,
  GraphicCode,
  MotionIdentity,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'
import type * as Compile from './graphic-code/compile'
import type * as DryRun from './graphic-code/dry-run'
import type * as Frames from './graphic-code/frames'
import { FramesUnavailable } from './graphic-code/frames'
import type * as MotionMetricsModule from './graphic-code/motion-metrics'
import { NonRetriableError } from 'inngest'
import type * as Db from '@boom-busters/db'
import type * as Schemas from '@boom-busters/schemas'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))

// The wrappers resolve the project's channel before they call the model; this
// file has no database, so the lookup answers with a fixed channel.
// The review is off unless a test turns it on (decision 389), so the two-call
// ladder below is the design's own.
let reviewSetting = false
// The channel's motion identity (spec 2026-11-04): the house one unless a test sets it.
let motionSetting: Partial<MotionIdentity> = {}
vi.mock('@boom-busters/db', async (importOriginal) => {
  const schemas = await import('@boom-busters/schemas')
  return {
    ...(await importOriginal<typeof Db>()),
    channelForProject: async () => ({
      channelId: '01J00000000000000000000CH1',
      slug: 'first',
      settings: {
        ...schemas.DEFAULT_SETTINGS,
        features: { ...schemas.DEFAULT_SETTINGS.features, graphicReview: reviewSetting },
        motion: { ...schemas.DEFAULT_MOTION_IDENTITY, ...motionSetting },
      },
      ...schemas.FIRST_CHANNEL_IN_USE,
    }),
    // The channel's approved exemplar version for a technique (spec 8.3): none unless a test
    // sets one, and only for the technique the row belongs to, as the real query answers.
    approvedExemplar: async (_db: unknown, _channelId: string, technique: string) =>
      approvedStub && approvedStub.technique === technique ? approvedStub : null,
    // The channel's own techniques (spec 8.5): none unless a test lists some.
    channelTechniquesFor: async () => channelTechniquesStub,
  }
})
let channelTechniquesStub: Schemas.ChannelTechnique[] = []

// A `channel_exemplars` row, as `channelExemplarFor` reads it; null is "no approved version".
let approvedStub: Db.ChannelExemplarRow | null = null

// The browser (decision 389): every inspection passes and photographs nothing
// unless a test hands it answers of its own.
const inspect = vi.fn<Frames.GraphicFrames['inspect']>()
// The measured motion (spec 2026-11-04, section 10.1): the stub's dense shots are not JPEGs, so the numbers are given.
const motionMetrics = vi.fn<typeof MotionMetricsModule.motionMetrics>()
// The channel's look references the critic is shown (spec 10.4): none unless a test gives some.
const criticReferencesFor = vi.fn(async (_channelId: string) => [] as Providers.CriticReference[])
vi.mock('./critic-references', () => ({
  criticReferencesFor: (channelId: string) => criticReferencesFor(channelId),
}))
vi.mock('./graphic-code/motion-metrics', () => ({
  motionMetrics: (...args: Parameters<typeof MotionMetricsModule.motionMetrics>) =>
    motionMetrics(...args),
}))
/** An inspection's result with the critic's fields empty unless a test fills them. */
const framed = (over: Partial<Frames.FramesResult>): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [],
  findings: [],
  dense: [],
  sheets: {},
  ...over,
})
vi.mock('./graphic-code/frames', async (importOriginal) => ({
  ...(await importOriginal<typeof Frames>()),
  browserFrames: () => ({ inspect: (input: Frames.FramesInput) => inspect(input) }),
}))
let mock = false
/** When set, stands in for the corpus: the exemplar every slot is sent. */
let exemplarStub: Providers.Exemplar | null = null
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const original = await importOriginal<typeof Providers>()
  return {
    ...original,
    mockProvidersEnabled: () => mock,
    exemplarFor: (technique: Providers.Technique) =>
      exemplarStub ?? original.exemplarFor(technique),
  }
})

let runtimeFault: Error | null = null
vi.mock('./graphic-code/dry-run', async (importOriginal) => {
  const original = await importOriginal<typeof DryRun>()
  return {
    ...original,
    ensureDryRunRuntime: () => {
      if (runtimeFault) throw runtimeFault
      original.ensureDryRunRuntime()
    },
  }
})

let compilerFault: Error | null = null
vi.mock('./graphic-code/compile', async (importOriginal) => {
  const original = await importOriginal<typeof Compile>()
  return {
    ...original,
    ensureGraphicCompiler: () => {
      if (compilerFault) throw compilerFault
      original.ensureGraphicCompiler()
    },
  }
})

import { graphicCodeIssue } from './graphic-code/check'
import { criticPlanOf, photographForCritic, slotIntent, slotTechnique } from './graphic-design-core'
import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import {
  channelExemplarFor,
  designGraphic,
  reviewGraphic,
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
  const land = Remotion.interpolate(frame, [27, 42], [0, 1], { easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drift = Remotion.interpolate(frame, [0, durationInFrames], [1, 1.04], { easing: motion.ease.linear })
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
  exemplarStub = null
  approvedStub = null
  reviewSetting = false
  motionSetting = {}
  // The config turns the browser off for every other file; this one stubs it.
  vi.stubEnv('GRAPHIC_FRAMES', 'on')
  inspect.mockReset()
  inspect.mockResolvedValue(framed({ layoutIssue: null, shots: [] }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const CUT_OFF = "the designer's answer was cut off at its length limit"
const TOO_LONG = 'the designer took too long; press Redesign to try again'

describe("the channel's exemplar in the per-shot call (spec 2026-11-04, section 8.3)", () => {
  const slotMessage = (call: number) =>
    (callLlm.mock.calls[call]![0].messages as { content: string }[])[1]!.content

  it("shows the designer the channel's approved exemplar for the slot's technique", async () => {
    approvedStub = {
      technique: 'text-highlight',
      plan: {
        slot: { intent: 'x', words: [] },
        concept: 'c',
        storyboard: ['0.0 s c'],
        mechanisms: ['drum', 'reel'],
        leansOn: [],
      },
      code: {
        title: "The channel's own",
        source: 'function Graphic(props) {\n  return "approved"\n}',
      },
    } as unknown as Db.ChannelExemplarRow
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(slotMessage(0)).toContain('A passing design of this technique (text-highlight:')
    expect(slotMessage(0)).toContain('return "approved"')
    expect(slotMessage(0)).toContain('It uses: drum, reel.')
  })

  it('shows the house exemplar when the channel has no approved version', async () => {
    const providers = await import('@boom-busters/providers')
    const house = providers.exemplarFor(slotTechnique(CONTEXT, SLOT, DEFAULT_MOTION_IDENTITY))!
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(slotMessage(0)).toContain(house.source)
  })
})

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

  it("carries a stored design's motion version to a redesign, and tells one stored before the tokens so (decision 301)", async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const designed = await designGraphic(CONTEXT, SLOT)
    if (!designed.ok) throw new Error('setup design failed')
    expect(designed.code.motion).toBe(2)
    const { motion: _motion, ...preToken } = designed.code
    callLlm.mockReset()
    callLlm.mockResolvedValue(answer('$4bn'))
    await designGraphic(
      CONTEXT,
      { ...SLOT, brief: { ...BRIEF, code: designed.code } },
      { redesign: true },
    )
    await designGraphic(
      CONTEXT,
      { ...SLOT, brief: { ...BRIEF, code: preToken } },
      { redesign: true },
    )
    expect(sent(0)).toContain('fontSize: 220')
    expect(sent(0)).not.toContain('written before the motion tokens')
    expect(sent(1)).toContain(
      '```\nThis design was written before the motion tokens: move every curve onto motion.ease',
    )
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

  it('designs with the channel identity: the prompt, the checks and the technique list (spec 2026-11-04)', async () => {
    motionSetting = {
      changeEveryMs: 6000,
      stillMaxMs: 9000,
      ms: { enter: 900 },
      techniques: ['kinetic-word-stack', 'bar-chart'],
    }
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    if (!result.ok) throw new Error(result.issue)
    expect(callLlm.mock.calls[0]![0].system).toContain('about every 6 seconds')
    expect(callLlm.mock.calls[0]![0].system).toContain('more than 9 seconds is refused')
    // One figure in the intent is a stat counter by the rules; switched off, the word stack stands in.
    expect(sent()).toContain('(kinetic-word-stack:')
    expect(sent()).not.toContain('(stat-counter:')
    expect(result.code.compiled).toContain('"enter":900')
    expect(result.code.motion).toBe(2)
  })

  it('checks the mock design against the channel identity (spec 2026-11-04)', async () => {
    mock = true
    motionSetting = { changeEveryMs: 6000, stillMaxMs: 9000, ms: { enter: 900 } }
    const result = await designGraphic(CONTEXT, SLOT)
    if (!result.ok) throw new Error(result.issue)
    expect(result.code.compiled).toContain('"enter":900')
    expect(result.code.motion).toBe(2)
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

describe('the exemplar handed in, and the photograph for the critic (plan 4)', () => {
  const GIVEN: Providers.Exemplar = {
    technique: 'stat-counter',
    description: 'one figure',
    mechanisms: ['drum'],
    title: 'Given by the caller',
    source: 'function Graphic(props) {\n  return "given"\n}',
  }

  it('uses the exemplar it is given and none when given null', async () => {
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    await designGraphicWith(complete, CONTEXT, SLOT, {
      bible: FIRST_CHANNEL_IN_USE,
      exemplar: GIVEN,
    })
    const first = complete.mock.calls[0]![0].messages as { content: string }[]
    expect(first[1]!.content).toContain('return "given"')

    complete.mockClear()
    await designGraphicWith(complete, CONTEXT, SLOT, {
      bible: FIRST_CHANNEL_IN_USE,
      exemplar: null,
    })
    const second = complete.mock.calls[0]![0].messages as { content: string }[]
    expect(second[1]!.content).not.toContain('A passing design of this technique')
    const providers = await import('@boom-busters/providers')
    expect(slotTechnique(CONTEXT, SLOT, DEFAULT_MOTION_IDENTITY)).toBe(
      providers.techniqueFor({
        type: 'graphic',
        intent: slotIntent(CONTEXT, SLOT.brief).intent,
        description: SLOT.brief.description ?? '',
        coversText: SLOT.brief.coversText,
        logos: CONTEXT.logos.map((logo) => logo.title),
        techniques: DEFAULT_MOTION_IDENTITY.techniques,
      }),
    )
  })

  it('photographForCritic returns the shots and the metrics, null without a browser', async () => {
    const code = (await designGraphicWith(
      vi.fn().mockResolvedValue(answer('$4bn')),
      CONTEXT,
      SLOT,
      {
        bible: FIRST_CHANNEL_IN_USE,
      },
    )) as { ok: true; code: GraphicCode }
    const shot = { orientation: 'landscape' as const, atMs: 900, jpeg: 'AAAA' }
    inspect.mockResolvedValueOnce({
      layoutIssue: null,
      shots: [shot],
      dense: [shot],
      sheets: { landscape: 'SHEET' },
      findings: ['while moving, at 1.3 s in landscape, "a" and "b" overlap'],
    })
    motionMetrics.mockResolvedValueOnce({
      frozenMs: 0,
      longestFrozenMs: 0,
      frozenCritical: false,
      simultaneity: 0.2,
      holdAfterLastMs: 500,
      speedProfile: [],
    })
    const photographed = await photographForCritic(CONTEXT, SLOT, code.code, {
      frames: { inspect },
      motion: DEFAULT_MOTION_IDENTITY,
      dense: [100, 200],
      deadline: Date.now() + 240_000,
    })
    if ('none' in photographed) throw new Error(`no frames: ${photographed.none}`)
    expect(photographed.photographed.shots).toEqual([shot])
    expect(photographed.photographed.findings).toHaveLength(1)
    expect(photographed.metrics?.simultaneity).toBe(0.2)
    expect(inspect.mock.calls[0]![0]).toMatchObject({
      shots: true,
      measure: 'findings',
      dense: [100, 200],
      sheets: true,
    })
    const none = await photographForCritic(CONTEXT, SLOT, code.code, {
      motion: DEFAULT_MOTION_IDENTITY,
      dense: [],
      deadline: Date.now() + 240_000,
    })
    expect(none).toEqual({ none: 'the browser is off' })
    expect(criticPlanOf(code.code, CONTEXT)).toMatchObject({ title: code.code.title })
  })
})

describe('photographForCritic says why it has no frames (decision 445)', () => {
  const designed = async () =>
    (
      (await designGraphicWith(vi.fn().mockResolvedValue(answer('$4bn')), CONTEXT, SLOT, {
        bible: FIRST_CHANNEL_IN_USE,
      })) as { ok: true; code: GraphicCode }
    ).code
  const options = (deadline = Date.now() + 240_000) => ({
    frames: { inspect },
    motion: DEFAULT_MOTION_IDENTITY,
    dense: [100],
    deadline,
  })

  it("names the browser's own failure", async () => {
    const code = await designed()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { FramesUnavailable } = await vi.importActual<typeof Frames>('./graphic-code/frames')
    inspect.mockRejectedValueOnce(
      new FramesUnavailable("the designer's frames: the inspection did not finish in 45 s"),
    )
    expect(await photographForCritic(CONTEXT, SLOT, code, options())).toEqual({
      none: "the designer's frames: the inspection did not finish in 45 s",
    })
  })

  it('says when the browser returned no rest shot, and when too little time was left', async () => {
    const code = await designed()
    inspect.mockResolvedValueOnce(framed({ layoutIssue: null, shots: [] }))
    expect(await photographForCritic(CONTEXT, SLOT, code, options())).toEqual({
      none: 'the browser returned no rest shot',
    })
    inspect.mockClear()
    expect(await photographForCritic(CONTEXT, SLOT, code, options(Date.now() + 5_000))).toEqual({
      none: 'too little of the step was left to start the browser',
    })
    expect(inspect).not.toHaveBeenCalled()
  })
})

describe('designGraphicWith (the model call is injected)', () => {
  it('sends the slot an exemplar of its technique when one is stored, and none before (decision 305)', async () => {
    const providers = await import('@boom-busters/providers')
    // The same values designGraphicWith hands techniqueFor: the slot's intent
    // as slotIntent resolves it, and the context's logo titles.
    const expected = providers.exemplarFor(
      providers.techniqueFor({
        type: 'graphic',
        intent: slotIntent(CONTEXT, BRIEF).intent,
        description: BRIEF.description,
        coversText: BRIEF.coversText,
        logos: CONTEXT.logos.map((logo) => logo.title),
      }),
    )
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    await designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE })
    const slot = (complete.mock.calls[0]![0].messages as { content: string }[])[1]!.content
    if (expected) {
      expect(slot).toContain(`A passing design of this technique (${expected.technique}:`)
      expect(slot).toContain(expected.source)
    } else {
      expect(slot).not.toContain('A passing design of this technique')
    }
  })

  it('a chart with no points still reaches the request, as a bar chart (decision 305)', async () => {
    const providers = await import('@boom-busters/providers')
    const empty: ChartBrief = {
      ...CHART,
      series: [{ label: 'Raised', unit: 'USD bn', points: [] }],
    }
    expect(
      providers.techniqueFor({
        type: 'chart',
        chartKind: empty.chartKind,
        seriesCount: empty.series.length,
        xLabels: [],
        intent: empty.takeaway,
        description: empty.description,
        coversText: empty.coversText,
        logos: [],
      }),
    ).toBe('bar-chart')
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    await designGraphicWith(
      complete,
      CONTEXT,
      { ...SLOT, brief: empty },
      { bible: FIRST_CHANNEL_IN_USE },
    )
    expect(complete).toHaveBeenCalled()
  })

  describe('with a stored exemplar (decision 305)', () => {
    const STORED: Providers.Exemplar = {
      technique: 'stat-counter',
      description: 'one large figure counting up to its mark, a label beneath, held',
      mechanisms: ['drum'],
      title: 'T',
      source: 'function Graphic(props) {\n  return null\n}',
    }
    const BLOCK = 'A passing design of this technique (stat-counter:'
    const messagesOf = (complete: ReturnType<typeof vi.fn>, call: number) =>
      complete.mock.calls[call]![0].messages as { content: string }[]

    beforeEach(() => {
      exemplarStub = STORED
    })

    it('carries the exemplar on the first call and on the retry, with the refusal last', async () => {
      const complete = vi
        .fn()
        .mockResolvedValueOnce({ text: JSON.stringify(BROKEN) })
        .mockResolvedValueOnce(answer('$4bn'))
      const result = await designGraphicWith(complete, CONTEXT, SLOT, {
        bible: FIRST_CHANNEL_IN_USE,
      })
      expect(result.ok).toBe(true)
      expect(complete).toHaveBeenCalledTimes(2)

      const first = messagesOf(complete, 0)
      expect(first[1]!.content).toContain(BLOCK)
      expect(first[1]!.content).toContain(STORED.source)

      const second = messagesOf(complete, 1)
      expect(second[1]!.content).toContain(BLOCK)
      expect(second[1]!.content).toContain(STORED.source)
      expect(second.at(-1)!.content).toBe(
        `Your previous answer for this slot was refused: ${issueOf(BROKEN)}. Answer again with that fixed.`,
      )
      expect(complete.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    })

    it('keeps the steer last on both calls, the exemplar still in the slot message', async () => {
      const complete = vi
        .fn()
        .mockResolvedValueOnce({ text: JSON.stringify(BROKEN) })
        .mockResolvedValueOnce(answer('$4bn'))
      const guidance = 'Make the number bigger.'
      const result = await designGraphicWith(complete, CONTEXT, SLOT, {
        bible: FIRST_CHANNEL_IN_USE,
        guidance,
      })
      expect(result.ok).toBe(true)
      expect(complete).toHaveBeenCalledTimes(2)
      for (const call of [0, 1]) {
        const messages = messagesOf(complete, call)
        expect(messages[1]!.content).toContain(BLOCK)
        expect(messages[1]!.content).toContain(STORED.source)
        expect(messages.at(-1)!.content).toBe(`The producer's steer: ${guidance}`)
      }
      // The refusal sits just before the steer on the retry.
      expect(messagesOf(complete, 1).at(-2)!.content).toContain(issueOf(BROKEN))
    })
  })

  it('stops non-retriably before any model call when the dry run cannot load its modules', async () => {
    runtimeFault = new Error("the designer's dry run cannot load remotion on this host: nope")
    try {
      const complete = vi.fn().mockResolvedValue(answer('$4bn'))
      await expect(
        designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE }),
      ).rejects.toThrow(NonRetriableError)
      await expect(
        designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE }),
      ).rejects.toThrow(/load remotion/)
      expect(complete).not.toHaveBeenCalled()
    } finally {
      runtimeFault = null
    }
  })

  it('stops non-retriably before any model call when esbuild cannot compile on this host (final review I2)', async () => {
    compilerFault = new Error(
      'the designer\'s checks cannot compile code on this host: The package "@esbuild/linux-x64" could not be found',
    )
    try {
      const complete = vi.fn().mockResolvedValue(answer('$4bn'))
      await expect(
        designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE }),
      ).rejects.toThrow(NonRetriableError)
      await expect(
        designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE }),
      ).rejects.toThrow(/cannot compile code on this host/)
      expect(complete).not.toHaveBeenCalled()
    } finally {
      compilerFault = null
    }
  })

  it('designs through the function it is given, handing it the request and a signal, and never touches callLlm', async () => {
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE })
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
    const result = await designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE })
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
    const result = await designGraphicWith(complete, CONTEXT, SLOT, { bible: FIRST_CHANNEL_IN_USE })
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

describe('the layout check in the design (decision 389)', () => {
  const LAYOUT =
    'at 1.6 s in landscape, "Raised in one round" and "$4bn" overlap; give each its own place, or let one leave before the other lands'

  it("refuses a design the browser finds colliding, retries with the browser's reason, and logs the refusal", async () => {
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    inspect
      .mockResolvedValueOnce(framed({ layoutIssue: LAYOUT, shots: [] }))
      .mockResolvedValueOnce(framed({ layoutIssue: null, shots: [] }))
    callLlm.mockResolvedValueOnce(answer('$4bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(sent(1)).toContain(LAYOUT)
    // The browser measures with the dry run's props, and photographs nothing for the design.
    expect(inspect.mock.calls[0]![0]).toMatchObject({ shots: false, measure: true })
    expect(inspect.mock.calls[0]![0].props.words).toEqual(WORDS)
    expect(String(logged.mock.calls[0]![0])).toBe(
      `[graphics] ${CONTEXT.projectId} c1 at 0.0 s: refused: ${LAYOUT}`,
    )
    logged.mockRestore()
  })

  it('hands back the last design only the browser refused, as a near miss (decision 445)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const SMALL =
      'at 5.4 s in landscape, "LOSS" is set at 25 px, too small to read on a phone; set it at least 32 px'
    inspect
      .mockResolvedValueOnce(framed({ layoutIssue: LAYOUT, shots: [] }))
      .mockResolvedValueOnce(framed({ layoutIssue: SMALL, shots: [] }))
    callLlm.mockResolvedValueOnce(answer('$4bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    if (result.ok) throw new Error('the design should be refused')
    expect(result.issue).toBe(SMALL)
    expect(result.nearMiss?.issue).toBe(SMALL)
    expect(result.nearMiss?.code.source).toBe(figureSource('$4bn'))
    expect(result.nearMiss?.code.compiled.length).toBeGreaterThan(0)
  })

  it('keeps the layout near miss when the retry fails a static check, and has none without one (decision 445)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    inspect.mockResolvedValueOnce(framed({ layoutIssue: LAYOUT, shots: [] }))
    callLlm.mockResolvedValueOnce(answer('$4bn')).mockResolvedValueOnce(answer('$5bn'))
    const mixed = await designGraphic(CONTEXT, SLOT)
    if (mixed.ok) throw new Error('the design should be refused')
    expect(mixed.issue).toBe(issueOf(planned('$5bn')))
    expect(mixed.nearMiss?.issue).toBe(LAYOUT)
    expect(mixed.nearMiss?.code.source).toBe(figureSource('$4bn'))

    callLlm.mockReset()
    callLlm.mockResolvedValue(answer('$5bn'))
    const staticOnly = await designGraphic(CONTEXT, SLOT)
    if (staticOnly.ok) throw new Error('the design should be refused')
    expect(staticOnly.nearMiss).toBeUndefined()
  })

  it('asks no review inside the design: one call, unmarked', async () => {
    reviewSetting = true
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok && result.code.review).toBeUndefined()
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it("bounds each inspection by the design's deadline, and starts none without the time", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    // A fresh design: the inspection's own ceiling.
    expect(inspect.mock.calls[0]![0].timeoutMs).toBe(45_000)

    inspect.mockClear()
    callLlm.mockImplementationOnce(async () => {
      // The answer came back with 25 s of the 240 s left: under the 20 s margin and the 10 s floor.
      vi.setSystemTime(Date.now() + 215_000)
      return answer('$4bn')
    })
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(inspect).not.toHaveBeenCalled()
  })

  it('designs on without the browser when it cannot start, saying so once at error level', async () => {
    const { FramesUnavailable } = await vi.importActual<typeof Frames>('./graphic-code/frames')
    inspect.mockRejectedValue(new FramesUnavailable('no Chromium on this host'))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, code: { source: figureSource('$4bn') } })
    expect(logged).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls[0]![0])).toContain(
      'without the browser: no Chromium on this host',
    )
    logged.mockRestore()
  })
})

describe('reviewGraphic, the critic in a step of its own (decision 389, spec 2026-11-04 section 10.4)', () => {
  const SHOT = { orientation: 'landscape' as const, atMs: 1600, jpeg: '/9j/AAAA' }
  const DENSE = [
    { orientation: 'landscape' as const, atMs: 250, jpeg: 'D1' },
    { orientation: 'landscape' as const, atMs: 500, jpeg: 'D2' },
  ]
  const SHEETS = { landscape: 'AAAA', portrait: 'BBBB' }
  const FINDING =
    'while moving, at 1.3 s in landscape, "a" and "b" overlap; give each its own place'
  const METRICS = {
    frozenMs: 1000,
    longestFrozenMs: 500,
    frozenCritical: false,
    simultaneity: 0.75,
    holdAfterLastMs: 1000,
    speedProfile: [{ atMs: 500, change: 0 }],
  }
  const AXES = ['engagement', 'intent', 'composition', 'temporal', 'craft'] as const
  const FIXES = ['bigger type', 'hold the end', 'one spring']
  const report = (over: Record<string, unknown> = {}) => ({
    text: JSON.stringify({
      scores: Object.fromEntries(AXES.map((axis) => [axis, { score: 8, line: 'fine' }])),
      defects: [],
      fixes: [],
      mechanisms: [],
      keep: true,
      ...over,
    }),
  })
  const photographed = () =>
    framed({ shots: [SHOT], dense: DENSE, sheets: SHEETS, findings: [FINDING] })
  const LAYOUT =
    'at 1.6 s in landscape, "Raised in one round" and "$4bn" overlap; give each its own place, or let one leave before the other lands'
  /** The slot with a stored design, as the review step reads it. */
  const stored = async () => {
    const designed = await designGraphic(CONTEXT, SLOT)
    if (!designed.ok) throw new Error(designed.issue)
    callLlm.mockReset()
    inspect.mockReset()
    return { ...SLOT, brief: { ...BRIEF, code: designed.code } }
  }

  beforeEach(() => {
    reviewSetting = true
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    motionMetrics.mockReset()
    motionMetrics.mockResolvedValue(METRICS)
  })

  it('photographs the design through its moves, measures it, and asks the critic', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed())
    callLlm.mockResolvedValueOnce(report())
    const result = await reviewGraphic(CONTEXT, slot)
    expect(result).toMatchObject({
      outcome: 'kept',
      code: { source: figureSource('$4bn'), review: 'kept', critique: { keep: true } },
    })
    // Photographed only, so a design stored before the layout check is still shown its frames.
    const asked = inspect.mock.calls[0]![0]
    expect(asked).toMatchObject({ shots: true, measure: 'findings', sheets: true })
    expect(asked.dense).toHaveLength(23)
    expect(motionMetrics).toHaveBeenCalledWith(DENSE, 6000, 6000)
    const [request, options] = callLlm.mock.calls[0]!
    expect(request.task).toBe('critic')
    expect(options).toMatchObject({ purpose: 'critic' })
    expect(request.messages[1].content).toContain('Longest frozen run 500 ms (limit 6000 ms)')
    expect(request.messages[1].content).toContain(`1. ${FINDING}`)
    // The plan as the designer answered it, claims by number.
    expect(request.messages[1].content).toContain('"claim": 1')
    const last = request.messages.at(-1)
    expect(last.images).toEqual([
      { mimeType: 'image/jpeg', data: 'AAAA' },
      { mimeType: 'image/jpeg', data: 'BBBB' },
      { mimeType: 'image/jpeg', data: '/9j/AAAA' },
    ])
    expect(last.content).toContain('Frame 1: 16:9 at 1.6 s')
  })

  it("hands the critic the channel's look references, before the sheets and the frames", async () => {
    const slot = await stored()
    const REF: Providers.CriticReference = {
      title: 'Kaye reel',
      purpose: 'look',
      carryOver: 'one actor',
      image: { mimeType: 'image/jpeg', data: 'RRRR' },
    }
    criticReferencesFor.mockResolvedValueOnce([REF])
    inspect.mockResolvedValueOnce(photographed())
    callLlm.mockResolvedValueOnce(report())
    await reviewGraphic(CONTEXT, slot)
    expect(criticReferencesFor).toHaveBeenCalledWith('01J00000000000000000000CH1')
    const last = callLlm.mock.calls[0]![0].messages.at(-1)
    expect(last.images[0]).toEqual(REF.image)
    expect(last.images).toHaveLength(4)
    expect(last.content).toContain('Reference 1: Kaye reel (look): one actor')
  })

  it("the review's fix is shown the channel technique the steer named (final review, issue 4)", async () => {
    const ledger: Schemas.ChannelTechnique = {
      technique: 'ledger-wipe',
      description: 'a ruled line wipes the old figure away',
      steerPhrases: ['ledger wipe'],
    }
    channelTechniquesStub = [ledger]
    motionSetting = { techniques: [...DEFAULT_MOTION_IDENTITY.techniques, 'ledger-wipe'] }
    approvedStub = {
      technique: 'ledger-wipe',
      plan: {
        slot: { intent: 'x', words: [] },
        concept: 'c',
        storyboard: ['c'],
        mechanisms: [],
        leansOn: [],
      },
      code: { title: 'The ledger', source: 'function Graphic(props) {\n  return "ledger"\n}' },
      proposal: { description: ledger.description, steerPhrases: ['ledger wipe'] },
    } as unknown as Db.ChannelExemplarRow
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed()).mockResolvedValueOnce(framed({}))
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: ['Hold the figure a second longer.'] }))
      .mockResolvedValueOnce({ text: JSON.stringify(planned('$4bn')) })
    await reviewGraphic(CONTEXT, slot, { guidance: 'as a ledger wipe' })
    const fix = callLlm.mock.calls[1]![0]
    expect(fix.messages[1]!.content).toContain('A passing design of this technique (ledger-wipe:')
    expect(fix.messages[1]!.content).toContain('return "ledger"')
    channelTechniquesStub = []
  })

  it('the review passes the same exemplar to the fix', async () => {
    approvedStub = {
      technique: 'text-highlight',
      plan: {
        slot: { intent: 'x', words: [] },
        concept: 'c',
        storyboard: ['0.0 s c'],
        mechanisms: ['drum'],
        leansOn: [],
      },
      code: {
        title: "The channel's own",
        source: 'function Graphic(props) {\n  return "approved"\n}',
      },
    } as unknown as Db.ChannelExemplarRow
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed()).mockResolvedValueOnce(framed({}))
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: ['Hold the figure a second longer.'] }))
      .mockResolvedValueOnce({ text: JSON.stringify(planned('$4bn')) })
    await reviewGraphic(CONTEXT, slot)
    const fix = callLlm.mock.calls[1]![0]
    expect(fix.messages[1]!.content).toContain('return "approved"')
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'fix' })
  })

  it('applies the three fixes as the steer of one designer call and takes a revision that passes', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed()).mockResolvedValueOnce(framed({}))
    const revised = { ...planned('$4bn'), title: 'Four billion, one round' }
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: FIXES }))
      .mockResolvedValueOnce({ text: JSON.stringify(revised) })
    const result = await reviewGraphic(CONTEXT, slot, { guidance: 'Slower.' })
    expect(result).toMatchObject({
      outcome: 'revised',
      code: { title: 'Four billion, one round', review: 'revised', critique: { keep: false } },
    })
    const [fix, fixOptions] = callLlm.mock.calls[1]!
    expect(fix.task).toBe('graphics')
    expect(fixOptions).toMatchObject({ purpose: 'fix' })
    expect(fix.messages.at(-1).content).toBe(
      "The producer's steer: Slower.\nThe critic's fixes, in order: 1. bigger type 2. hold the end 3. one spring",
    )
    expect(
      fix.messages.some((m: { content: string }) => m.content.includes('The current design')),
    ).toBe(true)
    expect(inspect.mock.calls[1]![0]).toMatchObject({ shots: false, measure: true })
  })

  it('keeps the design with its critique when the fix is refused by a check or the layout', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed())
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: FIXES }))
      .mockResolvedValueOnce(answer('$7bn'))
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
      outcome: 'kept',
      code: { source: figureSource('$4bn'), review: 'kept', critique: { keep: false } },
    })

    inspect
      .mockResolvedValueOnce(photographed())
      .mockResolvedValueOnce(framed({ layoutIssue: LAYOUT }))
    const revised = { ...planned('$4bn'), title: 'Four billion, one round' }
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: FIXES }))
      .mockResolvedValueOnce({ text: JSON.stringify(revised) })
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
      outcome: 'kept',
      code: { title: 'Raised in one round', review: 'kept', critique: { fixes: FIXES } },
    })
  })

  it('keeps the design with its critique when the fix cannot be checked in the browser (final review, issue 4)', async () => {
    const slot = await stored()
    inspect
      .mockResolvedValueOnce(photographed())
      .mockRejectedValueOnce(
        new FramesUnavailable('the designer\u2019s frames: the launch did not finish in 20 s'),
      )
    const revised = { ...planned('$4bn'), title: 'Four billion, one round' }
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: FIXES }))
      .mockResolvedValueOnce({ text: JSON.stringify(revised) })
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
      outcome: 'kept',
      code: { title: 'Raised in one round', review: 'kept', critique: { fixes: FIXES } },
    })
  })

  it('keeps the design with its critique when the fix call fails or the budget stops it (final review, issue 10)', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(photographed())
    callLlm
      .mockResolvedValueOnce(report({ keep: false, fixes: FIXES }))
      .mockRejectedValueOnce(new Error('provider down'))
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
      outcome: 'kept',
      code: { review: 'kept', critique: { keep: false } },
    })

    inspect.mockResolvedValueOnce(photographed())
    callLlm.mockResolvedValueOnce(report({ keep: false, fixes: FIXES })).mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 10,
        monthSpendUsd: 10,
        estimateUsd: 0.1,
      }),
    )
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
      outcome: 'kept',
      code: { review: 'kept', critique: { keep: false } },
    })
  })

  it("keeps the design and logs when the critic's report is malformed", async () => {
    const slot = await stored()
    const logged = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    inspect.mockResolvedValueOnce(photographed())
    callLlm.mockResolvedValueOnce({ text: '{"keep": true}' })
    const result = await reviewGraphic(CONTEXT, slot)
    expect(result).toMatchObject({ outcome: 'kept', code: { review: 'kept' } })
    expect((result as { code: { critique?: unknown } }).code.critique).toBeUndefined()
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(String(logged.mock.calls.at(-1)![0])).toMatch(/the critic's report was malformed/)
    logged.mockRestore()
  })

  it('runs the critic without metrics when the dense set is empty', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(
      framed({ shots: [SHOT], findings: ['the dense set was cut short at 0 of 46 shots'] }),
    )
    motionMetrics.mockResolvedValue(null)
    callLlm.mockResolvedValueOnce(report())
    expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({ outcome: 'kept' })
    const [request] = callLlm.mock.calls[0]!
    expect(request.messages[1].content).toContain('No motion was measured.')
    expect(request.messages[1].content).toContain('cut short')
    expect(request.messages.at(-1).images).toEqual([{ mimeType: 'image/jpeg', data: '/9j/AAAA' }])
  })

  it('keeps the design when the fix would not fit the deadline', async () => {
    const slot = await stored()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      inspect.mockResolvedValueOnce(photographed())
      callLlm.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 200_000)
        return report({ keep: false, fixes: FIXES })
      })
      expect(await reviewGraphic(CONTEXT, slot)).toMatchObject({
        outcome: 'kept',
        code: { review: 'kept', critique: { keep: false } },
      })
      expect(callLlm).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips, saying why at error level, when the critic call fails or the budget stops it', async () => {
    const slot = await stored()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    inspect.mockResolvedValueOnce(photographed())
    callLlm.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.critic',
        budgetUsd: 10,
        monthSpendUsd: 10,
        estimateUsd: 0.1,
      }),
    )
    const result = await reviewGraphic(CONTEXT, slot)
    expect(result.outcome).toBe('skipped')
    expect(String(logged.mock.calls[0]![0])).toMatch(/review skipped: the review failed: /)
    logged.mockRestore()
  })

  it('skips with no frames to show, and when Settings has it off, without a call', async () => {
    const slot = await stored()
    inspect.mockResolvedValueOnce(framed({}))
    expect(await reviewGraphic(CONTEXT, slot)).toEqual({
      outcome: 'skipped',
      reason: 'no frames to show',
    })

    reviewSetting = false
    expect(await reviewGraphic(CONTEXT, slot)).toEqual({
      outcome: 'skipped',
      reason: 'switched off in Settings',
    })
    expect(callLlm).not.toHaveBeenCalled()
  })
})

describe('channel-only techniques (spec 2026-11-04, section 8.5)', () => {
  const ledger: Schemas.ChannelTechnique = {
    technique: 'ledger-wipe',
    description: 'a ruled line wipes the old figure away',
    steerPhrases: ['ledger wipe'],
  }
  afterEach(() => {
    channelTechniquesStub = []
    approvedStub = null
  })

  it('a steer that says a channel phrase picks the channel technique for the slot', () => {
    expect(
      slotTechnique(CONTEXT, SLOT, DEFAULT_MOTION_IDENTITY, 'as a ledger wipe', [ledger]),
    ).toBe('ledger-wipe')
    expect(slotTechnique(CONTEXT, SLOT, DEFAULT_MOTION_IDENTITY, 'as a ledger wipe')).not.toBe(
      'ledger-wipe',
    )
  })

  it("channelExemplarFor hands the designer the channel's approved version of its own technique, and nothing before approval", async () => {
    expect(await channelExemplarFor('01J00000000000000000000CH1', 'ledger-wipe')).toBeUndefined()
    approvedStub = {
      technique: 'ledger-wipe',
      plan: {
        slot: { intent: 'x', words: [] },
        concept: 'c',
        storyboard: ['0.0 s c'],
        mechanisms: ['persistent-actor'],
        leansOn: [],
      },
      code: { title: 'The ledger', source: 'function Graphic(props) {\n  return "ledger"\n}' },
      proposal: {
        key: 'ledger-wipe',
        name: 'Ledger wipe',
        description: ledger.description,
        steerPhrases: ['ledger wipe'],
        mechanisms: ['persistent-actor'],
        slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'i' },
        fromReference: 'Ledger scene',
      },
    } as unknown as Db.ChannelExemplarRow
    const exemplar = await channelExemplarFor('01J00000000000000000000CH1', 'ledger-wipe')
    expect(exemplar).toEqual({
      technique: 'ledger-wipe',
      description: ledger.description,
      mechanisms: ['persistent-actor'],
      title: 'The ledger',
      source: 'function Graphic(props) {\n  return "ledger"\n}',
    })
  })

  it("designGraphic honours the channel's phrase only while the key is in use", async () => {
    channelTechniquesStub = [ledger]
    approvedStub = {
      technique: 'ledger-wipe',
      plan: {
        slot: { intent: 'x', words: [] },
        concept: 'c',
        storyboard: ['c'],
        mechanisms: [],
        leansOn: [],
      },
      code: { title: 'The ledger', source: 'function Graphic(props) {\n  return "ledger"\n}' },
      proposal: { description: ledger.description, steerPhrases: ['ledger wipe'] },
    } as unknown as Db.ChannelExemplarRow
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT, { guidance: 'as a ledger wipe' })
    const slotMessage = (callLlm.mock.calls[0]![0].messages as { content: string }[])[1]!.content
    expect(slotMessage).not.toContain('(ledger-wipe:')
    motionSetting = { techniques: [...DEFAULT_MOTION_IDENTITY.techniques, 'ledger-wipe'] }
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT, { guidance: 'as a ledger wipe' })
    const second = (callLlm.mock.calls[1]![0].messages as { content: string }[])[1]!.content
    expect(second).toContain('A passing design of this technique (ledger-wipe:')
    expect(second).toContain('return "ledger"')
  })
})

// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError, teaserTextHash } from '@boom-busters/schemas'
import type {
  GraphicCodePayload,
  PointPlanRecord,
  PointPlanShot,
  PointScript,
  PointVoiceRecord,
  TimelineSlot,
} from '@boom-busters/schemas'
import { POINT_CHAPTER_ID, pointGraphicWindow } from '@boom-busters/timeline'
import type * as Db from '@boom-busters/db'
import type * as GraphicDesign from '@/lib/graphic-design'

const designGraphic = vi.fn()
const reviewGraphic = vi.fn()
const loadGraphicContext = vi.fn()
vi.mock('@/lib/graphic-design', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphicDesign>()),
  designGraphic: (...args: unknown[]) => designGraphic(...args),
  reviewGraphic: (...args: unknown[]) => reviewGraphic(...args),
  loadGraphicContext: (...args: unknown[]) => loadGraphicContext(...args),
}))
const listShotSlots = vi.fn()
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  listShotSlots: (...args: unknown[]) => listShotSlots(...args),
}))

import {
  designShortGraphics,
  NO_FILM_BRIEF_ISSUE,
  SHORT_GAVE_UP_ISSUE,
  shortClock,
} from './point-design'
import { DESIGN_COLLECTS_MAX } from './graphic-steps'

const CLAIM = '01J00000000000000000000001'
const OTHER_CLAIM = '01J00000000000000000000002'

/** Five one-sentence paragraphs of ten words, so every tenth word opens a phrase. */
const SCRIPT: PointScript = {
  title: 'The cash pile',
  paragraphs: (['hook', 'stakes', 'delivery', 'resolution', 'bridge'] as const).map(
    (phase, at) => ({
      phase,
      chapterIndex: 0,
      text: `${phase} one two three four five six seven eight ${at}.`,
    }),
  ),
}
const VOICE: PointVoiceRecord = {
  scriptVersion: 1,
  paragraphs: SCRIPT.paragraphs.map((p, at) => ({
    textHash: teaserTextHash(p.text),
    r2Key: `voice/${at}.wav`,
    durationMs: 4000,
    wordTimings: null,
  })),
}

const FILM_CODE = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'function Graphic() {\n  return null;\n}\n',
  title: 'The film cash pile',
  facts: [],
  words: [{ text: 'film', atMs: 0 }],
  durationMs: 9000,
}
const SHORT_CODE = {
  ...FILM_CODE,
  source: 'function Graphic() { return 1 }',
  compiled: 'function Graphic() {\n  return 1;\n}\n',
  title: 'The Short cash pile',
  facts: [{ text: '$4bn', claimId: CLAIM }],
  words: [{ text: 'delivery', atMs: 0 }],
  durationMs: 5000,
}

const filmPayload: GraphicCodePayload = {
  kind: 'graphic-code',
  version: 1,
  compiled: FILM_CODE.compiled,
  title: FILM_CODE.title,
  words: FILM_CODE.words,
  durationMs: FILM_CODE.durationMs,
  logos: { Acme: { r2Key: 'logos/acme.png', width: 300, height: 100 } },
  claimIds: [OTHER_CLAIM],
}
const graphicSlot: TimelineSlot = {
  type: 'graphic',
  startMs: 0,
  durationMs: 9000,
  transition: 'cut',
  motion: { kind: 'static' },
  payload: filmPayload,
}
const photo = (name: string): TimelineSlot => ({
  type: 'still',
  startMs: 0,
  durationMs: 3000,
  transition: 'cut',
  motion: { kind: 'static' },
  payload: { kind: 'image', src: { r2Key: `stills/${name}.png` } },
})
const shot = (startWord: number, slot: TimelineSlot, over: Partial<PointPlanShot> = {}) => ({
  startWord,
  crop: 'centre' as const,
  motion: 'static' as const,
  slot,
  pending: null,
  ...over,
})
const plan = (shots: PointPlanShot[]): PointPlanRecord => ({
  shots,
  plannedFor: { scriptVersion: 1, voiceHash: 'v' },
})
/** A photo, the film's graphic over the delivery, and a photo for the bridge. */
const PLAN = plan([shot(0, photo('a')), shot(20, graphicSlot), shot(40, photo('b'))])

const FILM_ROW = {
  id: 'row-1',
  chapterId: 'chapter-1',
  type: 'graphic',
  brief: {
    type: 'graphic',
    coversText: 'The film said it its own way.',
    description: 'A pile of cash.',
    motion: { kind: 'static' },
    transition: 'cut',
    intent: 'The pile kept growing.',
    intentClaimIds: [CLAIM],
    code: FILM_CODE,
  },
}
const FILM_CONTEXT = {
  projectId: 'p',
  caseTitle: 'WeWork',
  claims: [],
  logos: [],
  paragraphs: [
    { chapterId: 'chapter-1', index: 0, text: 'film', startMs: 0, durationMs: 1, words: [] },
  ],
  chapterTitle: 'The money',
}

const steps: string[] = []
const run = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  steps.push(id)
  return fn()
}
const designOf = (over: Partial<Parameters<typeof designShortGraphics>[1]> = {}) =>
  designShortGraphics(run, { projectId: 'p', script: SCRIPT, voice: VOICE, plan: PLAN, ...over })

beforeEach(() => {
  steps.length = 0
  designGraphic.mockReset()
  reviewGraphic.mockReset()
  reviewGraphic.mockResolvedValue({ outcome: 'skipped', reason: 'switched off in Settings' })
  loadGraphicContext.mockReset()
  loadGraphicContext.mockResolvedValue(FILM_CONTEXT)
  listShotSlots.mockReset()
  listShotSlots.mockResolvedValue([
    { id: 'row-0', chapterId: 'chapter-1', type: 'still', brief: {} },
    FILM_ROW,
  ])
})

describe("designShortGraphics: a Short's own graphics (decision 476)", () => {
  it("designs a lifted graphic from the Short's words, for 9:16, shown the film's design", async () => {
    designGraphic.mockResolvedValue({ ok: true, code: SHORT_CODE })
    const result = await designOf({ runId: 'run-1' })
    if (!result.ok) throw new Error('unreachable')

    const clock = shortClock(SCRIPT, VOICE, PLAN)
    const at = clock.shots.findIndex((s) => s.slot?.payload.kind === 'graphic-code')
    const window = pointGraphicWindow(
      clock.shots,
      at,
      clock.narration.words,
      clock.narration.narrationEndMs,
    )
    const cues = clock.narration.words.slice(window.firstWord, window.cueEndWord + 1)

    expect(designGraphic).toHaveBeenCalledTimes(1)
    const [context, slot, options] = designGraphic.mock.calls[0]!
    // The film's context, its chapter read from the board row, with the Short's narration.
    expect(loadGraphicContext).toHaveBeenCalledWith('p', 'chapter-1')
    expect(context).toMatchObject({ caseTitle: 'WeWork', chapterTitle: 'The money' })
    expect(context.paragraphs).toEqual([
      {
        chapterId: POINT_CHAPTER_ID,
        index: 0,
        text: SCRIPT.paragraphs.map((p) => p.text).join('\n\n'),
        startMs: 0,
        durationMs: clock.narration.narrationEndMs,
        words: cues.map((word) => ({ text: word.text, startMs: word.startMs })),
      },
    ])
    // The window the compile plays the code in, on the Short's own words.
    expect(slot).toMatchObject({
      chapterId: POINT_CHAPTER_ID,
      startMs: window.startMs,
      durationMs: window.plannedMs,
      brief: { intent: 'The pile kept growing.', coversText: cues.map((w) => w.text).join(' ') },
    })
    expect(cues[0]!.text).toBe('delivery')
    expect(options).toEqual({
      firstOnly: true,
      frame: 'short',
      filmDesign: FILM_CODE,
      bridgeJobScope: 'run-1/short-graphic-0',
    })

    const designed = result.plan.shots[at]!
    expect(designed.shortDesign).toEqual({ outcome: 'designed' })
    expect(designed.slot!.type).toBe('graphic')
    expect(designed.slot!.payload).toEqual({
      ...filmPayload,
      version: SHORT_CODE.version,
      compiled: SHORT_CODE.compiled,
      title: SHORT_CODE.title,
      words: SHORT_CODE.words,
      durationMs: SHORT_CODE.durationMs,
      claimIds: [CLAIM, OTHER_CLAIM],
    })
    expect(result.changed).toBe(true)
    expect(result.kept).toEqual([])
    expect(steps).toEqual(['short-graphic-0', 'short-graphic-0-review'])
  })

  it('stores what the review made of the design, reviewing it in 9:16', async () => {
    designGraphic.mockResolvedValue({ ok: true, code: SHORT_CODE })
    reviewGraphic.mockResolvedValue({
      outcome: 'revised',
      code: { ...SHORT_CODE, title: 'Revised', review: 'revised' },
    })
    const result = await designOf()
    if (!result.ok) throw new Error('unreachable')
    const [, slot, options] = reviewGraphic.mock.calls[0]!
    expect(slot.brief.code).toEqual(SHORT_CODE)
    expect(options).toEqual({ frame: 'short', filmDesign: FILM_CODE })
    const designed = result.plan.shots.find((s) => s.shortDesign)!
    expect(designed.slot!.payload).toMatchObject({ title: 'Revised' })
  })

  it('returns the plan paced as the compile paces it, pictures untouched', async () => {
    designGraphic.mockResolvedValue({ ok: true, code: SHORT_CODE })
    const result = await designOf()
    if (!result.ok) throw new Error('unreachable')
    const paced = shortClock(SCRIPT, VOICE, PLAN).shots
    expect(result.plan.shots.map((s) => s.startWord)).toEqual(paced.map((s) => s.startWord))
    expect(result.plan.shots.filter((s) => s.slot?.payload.kind === 'image')).toEqual(
      paced.filter((s) => s.slot?.payload.kind === 'image'),
    )
    expect(result.plan.plannedFor).toEqual(PLAN.plannedFor)
  })

  it('leaves a plan with no graphic, or one already tried, as it is, with no steps', async () => {
    const tried = plan([
      shot(0, photo('a')),
      shot(20, graphicSlot, { shortDesign: { outcome: 'kept', issue: 'earlier' } }),
      shot(40, photo('b')),
    ])
    const result = await designOf({ plan: tried })
    expect(result).toMatchObject({ ok: true, changed: false, kept: [] })
    expect(designGraphic).not.toHaveBeenCalled()
    expect(steps).toEqual([])
  })

  it("keeps the film's design with why when the Short's is refused twice", async () => {
    const retry = { call: 'retry: refused', issue: 'the figure is not cited' }
    designGraphic
      .mockResolvedValueOnce({ ok: false, issue: 'the figure is not cited', retry })
      .mockResolvedValueOnce({ ok: false, issue: 'the figure is still not cited' })
    const result = await designOf()
    if (!result.ok) throw new Error('unreachable')
    expect(designGraphic.mock.calls[1]![2]).toMatchObject({ resume: retry, frame: 'short' })
    expect(steps).toEqual(['short-graphic-0', 'short-graphic-0-retry'])
    const kept = result.plan.shots.find((s) => s.shortDesign)!
    expect(kept.slot!.payload).toEqual(filmPayload)
    expect(kept.shortDesign).toEqual({ outcome: 'kept', issue: 'the figure is still not cited' })
    expect(result.kept).toEqual([
      expect.stringMatching(
        /^Shot \d+ plays the film's graphic: the Short's own could not be made: the figure is still not cited$/,
      ),
    ])
    expect(result.changed).toBe(true)
  })

  it("keeps the film's design when its brief is gone from the board, asking nothing", async () => {
    listShotSlots.mockResolvedValue([])
    const result = await designOf()
    if (!result.ok) throw new Error('unreachable')
    expect(designGraphic).not.toHaveBeenCalled()
    expect(result.plan.shots.find((s) => s.shortDesign)!.shortDesign).toEqual({
      outcome: 'kept',
      issue: NO_FILM_BRIEF_ISSUE,
    })
  })

  it('says the designer gave up when the bridge never answered', async () => {
    designGraphic.mockResolvedValue({ ok: false, issue: 'still writing', pending: true })
    const result = await designOf()
    if (!result.ok) throw new Error('unreachable')
    expect(steps).toHaveLength(1 + DESIGN_COLLECTS_MAX)
    expect(result.plan.shots.find((s) => s.shortDesign)!.shortDesign).toEqual({
      outcome: 'kept',
      issue: SHORT_GAVE_UP_ISSUE,
    })
  })

  it('stops on the budget, with its gate', async () => {
    designGraphic.mockRejectedValue(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    const result = await designOf()
    expect(result).toMatchObject({ ok: false, gate: expect.any(Object) })
  })
})

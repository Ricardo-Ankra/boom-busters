// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError } from '@boom-busters/schemas'
import type * as GraphicDesign from '@/lib/graphic-design'

const designGraphic = vi.fn()
const reviewGraphic = vi.fn()
vi.mock('@/lib/graphic-design', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphicDesign>()),
  designGraphic: (...args: unknown[]) => designGraphic(...args),
  reviewGraphic: (...args: unknown[]) => reviewGraphic(...args),
}))

import { DESIGN_COLLECTS_MAX, designPlannedGraphics, GAVE_UP_ISSUE } from './graphic-steps'

const graphic = (coversText: string) => ({
  chapterId: 'c1',
  index: 0,
  type: 'graphic',
  startMs: 0,
  durationMs: 6000,
  brief: {
    type: 'graphic',
    coversText,
    description: 'd',
    motion: { kind: 'static' },
    transition: 'cut',
    intent: 'i',
    intentClaimIds: [],
  },
})
const still = {
  chapterId: 'c1',
  index: 1,
  type: 'still',
  startMs: 6000,
  durationMs: 3000,
  brief: { type: 'still' },
}
/** A chart as the shot list plans it, or (with `code`) one designed before. */
const chart = (code?: unknown) => ({
  chapterId: 'c1',
  index: 2,
  type: 'chart',
  startMs: 9000,
  durationMs: 6000,
  brief: {
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
    dataRefs: ['01J00000000000000000000001'],
    takeaway: 'Four billion in a year.',
    reveal: 'draw-on',
    ...(code ? { code } : {}),
  },
})
const CODE = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'function Graphic() {\n  return null;\n}\n',
  title: 'Designed before',
  facts: [],
  words: [],
  durationMs: 6000,
}
const CONTEXT = {
  projectId: 'p',
  caseTitle: 'c',
  claims: [],
  logos: [],
  paragraphs: [],
}

beforeEach(() => {
  designGraphic.mockReset()
  reviewGraphic.mockReset()
  reviewGraphic.mockResolvedValue({ outcome: 'skipped', reason: 'switched off in Settings' })
})

describe('designPlannedGraphics (decisions 289, 295)', () => {
  it('stores what the review step made of a design, and the design itself when it skipped (decision 389)', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, code: CODE })
      .mockResolvedValueOnce({ ok: true, code: CODE })
    reviewGraphic
      .mockResolvedValueOnce({
        outcome: 'revised',
        code: { ...CODE, title: 'Revised', review: 'revised' },
      })
      .mockResolvedValueOnce({ outcome: 'skipped', reason: 'no frames to show' })
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [graphic('a'), graphic('b')] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ code: { title: 'Revised', review: 'revised' } })
    expect(result.rows[1]!.brief).toMatchObject({ code: CODE })
    // The review is handed the designed brief on the slot's own clock.
    expect(reviewGraphic.mock.calls[0]![1]).toMatchObject({
      chapterId: 'c1',
      startMs: 0,
      durationMs: 6000,
      brief: { code: CODE },
    })
  })

  it('runs one named step per graphic and leaves other rows alone', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, code: CODE })
      .mockResolvedValueOnce({ ok: false, issue: 'no digits' })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [graphic('a'), still, graphic('b')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
      },
    )
    // A design that lands is reviewed in a step of its own (decision 389); a refused one is not.
    expect(ids).toEqual(['graphic-0-0', 'graphic-0-0-review', 'graphic-0-1'])
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ code: CODE })
    expect(result.rows[1]).toBe(still)
    expect(result.rows[2]!.brief).toMatchObject({ designIssue: 'no digits' })
  })

  it('designs a chart without code in a step of its own, and counts a refused design (decision 295)', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, code: CODE })
      .mockResolvedValueOnce({ ok: false, issue: 'nothing changes between 1.0 s and 8.0 s' })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [chart(), graphic('a')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
      },
    )
    // A chart takes ids of its own; graphics keep the numbering they had.
    expect(ids).toEqual(['graphic-0-chart-0', 'graphic-0-chart-0-review', 'graphic-0-0'])
    expect(designGraphic.mock.calls[0]![1]).toMatchObject({
      chapterId: 'c1',
      startMs: 9000,
      durationMs: 6000,
      brief: { type: 'chart', takeaway: 'Four billion in a year.' },
    })
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ type: 'chart', code: CODE })
    expect(result.rows[1]!.brief).toMatchObject({
      type: 'graphic',
      designIssue: 'nothing changes between 1.0 s and 8.0 s',
    })
  })

  it('makes the retry a first answer earned in a step of its own (decision 470)', async () => {
    const retry = { call: 'retry: refused', issue: '"From 97%" is set at 26 px' }
    designGraphic
      .mockResolvedValueOnce({ ok: false, issue: '"From 97%" is set at 26 px', retry })
      .mockResolvedValueOnce({ ok: true, code: CODE })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [chart()] as never,
        context: CONTEXT,
        chapterTitle: 'One',
      },
    )
    expect(ids).toEqual([
      'graphic-0-chart-0',
      'graphic-0-chart-0-retry',
      'graphic-0-chart-0-review',
    ])
    expect(designGraphic.mock.calls[0]![2]).toEqual({ firstOnly: true })
    expect(designGraphic.mock.calls[1]![2]).toEqual({ resume: retry })
    expect(result).toMatchObject({ ok: true, undesigned: 0 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ type: 'chart', code: CODE })
    expect(result.rows[0]!.brief).not.toHaveProperty('designIssue')
  })

  it("stores the retry's issue when the retry is refused too (decision 470)", async () => {
    designGraphic
      .mockResolvedValueOnce({
        ok: false,
        issue: 'first',
        retry: { call: 'retry: refused', issue: 'first' },
      })
      .mockResolvedValueOnce({ ok: false, issue: 'second' })
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [graphic('a')] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(designGraphic).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ designIssue: 'second' })
  })

  it('collects an answer the bridge was still writing in the next steps, under one job name (decision 472)', async () => {
    const pending = { ok: false, issue: 'still writing', pending: true }
    designGraphic
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ok: true, code: CODE })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [graphic('a')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
        runId: 'run-1',
      },
    )
    expect(ids).toEqual([
      'graphic-0-0',
      'graphic-0-0-collect-1',
      'graphic-0-0-collect-2',
      'graphic-0-0-review',
    ])
    // Every step of the attempt asks under the same job name, so it collects that answer.
    for (const call of designGraphic.mock.calls) {
      expect(call[2]).toEqual({ firstOnly: true, bridgeJobScope: 'run-1/graphic-0-0' })
    }
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ code: CODE })
    expect(result).toMatchObject({ undesigned: 0 })
  })

  it('says so on the slot when every collect is still writing (decision 472)', async () => {
    designGraphic.mockResolvedValue({ ok: false, issue: 'still writing', pending: true })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [graphic('a')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
        runId: 'run-1',
      },
    )
    expect(ids).toHaveLength(1 + DESIGN_COLLECTS_MAX)
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ designIssue: GAVE_UP_ISSUE })
    expect(result).toMatchObject({ undesigned: 1 })
  })

  it('names no job without a run, so a call runs as before (decision 472)', async () => {
    designGraphic.mockResolvedValueOnce({ ok: true, code: CODE })
    await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [graphic('a')] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(designGraphic.mock.calls[0]![2]).toEqual({ firstOnly: true })
  })

  it('leaves a chart that already carries code alone (decision 295)', async () => {
    const designed = chart(CODE)
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [designed] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(designGraphic).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, undesigned: 0 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]).toBe(designed)
  })

  it('returns a gate when the budget runs out', async () => {
    designGraphic.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [graphic('a')] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(result.ok).toBe(false)
  })
})

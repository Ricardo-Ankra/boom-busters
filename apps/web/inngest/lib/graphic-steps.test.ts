// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError } from '@boom-busters/schemas'
import type * as GraphicDesign from '@/lib/graphic-design'

const designGraphic = vi.fn()
vi.mock('@/lib/graphic-design', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphicDesign>()),
  designGraphic: (...args: unknown[]) => designGraphic(...args),
}))

import { designPlannedGraphics } from './graphic-steps'

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
})

describe('designPlannedGraphics (decisions 289, 295)', () => {
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
    expect(ids).toEqual(['graphic-0-0', 'graphic-0-1'])
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
    expect(ids).toEqual(['graphic-0-chart-0', 'graphic-0-0'])
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

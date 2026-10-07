import { describe, expect, it, vi } from 'vitest'
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
const CONTEXT = { projectId: 'p', caseTitle: 'c', claims: [], logos: [], paragraphs: [] }

describe('designPlannedGraphics (decision 289)', () => {
  it('runs one named step per graphic and leaves other rows alone', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, scene: { elements: [] } })
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
    expect(result.rows[0]!.brief).toMatchObject({ scene: { elements: [] } })
    expect(result.rows[1]).toBe(still)
    expect(result.rows[2]!.brief).toMatchObject({ designIssue: 'no digits' })
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

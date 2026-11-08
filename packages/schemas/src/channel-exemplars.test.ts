import { describe, expect, it } from 'vitest'
import {
  DERIVE_CAP_WARN_USD,
  DERIVE_ROUNDS_DEFAULT,
  DERIVE_ROUNDS_MAX,
  DeriveRequestSchema,
  EXEMPLAR_STATUSES,
  EXEMPLAR_STEER_MAX,
  ExemplarFramesSchema,
  ExemplarPlanSchema,
  ExemplarSteerSchema,
  PLAN_LEANS_ON_MAX,
  TECHNIQUE_PROGRESS_STATES,
  TechniqueProgressSchema,
  VERDICT_KINDS,
  planIssue,
} from './channel-exemplars'
import type { ExemplarPlan } from './channel-exemplars'

const w = (atMs: number, text = 'word') => ({ text, atMs })
const six = [0, 500, 1000, 1500, 2000, 2500].map((at) => w(at))
const twelve = Array.from({ length: 12 }, (_, i) => w(i * 400))

const plan = (patch: Partial<ExemplarPlan> & { words?: ExemplarPlan['slot']['words'] } = {}) => {
  const { words, ...rest } = patch
  return {
    slot: { intent: 'The figure is the whole story.', words: words ?? six },
    concept: 'one figure rises out of the sentence',
    storyboard: ['0.0 s the sentence lands', '2.0 s the figure rises'],
    mechanisms: ['word-splits-open', 'drum'],
    leansOn: [{ title: 'Numeral over a changing background', why: 'the held numeral' }],
    ...rest,
  } as ExemplarPlan
}

describe('the exemplar plan (spec 2026-11-04, section 9.2)', () => {
  it('accepts a plan with a rewritten slot, a storyboard, mechanisms and three references', () => {
    const leansOn = Array.from({ length: PLAN_LEANS_ON_MAX }, (_, i) => ({
      title: `Reference ${i + 1}`,
      why: 'its pacing',
    }))
    expect(ExemplarPlanSchema.safeParse(plan({ leansOn })).success).toBe(true)
  })

  it('refuses more than three references, more than six mechanisms, or an empty storyboard', () => {
    const four = Array.from({ length: 4 }, (_, i) => ({ title: `R${i}`, why: 'why' }))
    expect(ExemplarPlanSchema.safeParse(plan({ leansOn: four })).success).toBe(false)
    const seven = Array.from({ length: 7 }, () => 'drum' as const)
    expect(ExemplarPlanSchema.safeParse(plan({ mechanisms: seven })).success).toBe(false)
    expect(ExemplarPlanSchema.safeParse(plan({ storyboard: [] })).success).toBe(false)
  })

  it('planIssue names words past the clock, out of order, or a third too many', () => {
    expect(planIssue(plan({ words: [w(6000)] }), { durationMs: 6000, wordCount: 1 })).toMatch(
      /past the slot/,
    )
    expect(
      planIssue(plan({ words: [w(0), w(500), w(400)] }), { durationMs: 6000, wordCount: 3 }),
    ).toMatch(/in order/)
    expect(planIssue(plan({ words: twelve }), { durationMs: 6000, wordCount: 6 })).toMatch(/words/)
    expect(planIssue(plan({ words: six }), { durationMs: 6000, wordCount: 6 })).toBeNull()
  })

  it('planIssue holds a chart plan to the series and point counts, and a graphic plan to no data', () => {
    const series = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        label: `S${i}`,
        unit: 'bn',
        points: [
          { x: '2020', y: 1 },
          { x: '2021', y: 2 },
        ],
      }))
    const chart = (n: number) =>
      plan({ slot: { intent: 'x', words: six, data: { series: series(n), takeaway: 'up' } } })
    const bounds = { durationMs: 6000, wordCount: 6, chart: { series: 2, points: 2 } }
    expect(planIssue(chart(2), bounds)).toBeNull()
    expect(planIssue(chart(1), bounds)).toMatch(/2 series of 2 points/)
    expect(planIssue(plan(), bounds)).toMatch(/2 series/)
    expect(planIssue(chart(1), { durationMs: 6000, wordCount: 6 })).toMatch(/no chart data/)
  })

  it('the derive request holds rounds to 1..5 and needs a positive cap', () => {
    expect(DERIVE_ROUNDS_DEFAULT).toBe(2)
    expect(DERIVE_ROUNDS_MAX).toBe(5)
    expect(DERIVE_CAP_WARN_USD).toBe(20)
    const ok = { techniques: ['stat-counter'], rounds: 2, capUsd: 5 }
    expect(DeriveRequestSchema.safeParse(ok).success).toBe(true)
    expect(DeriveRequestSchema.safeParse({ ...ok, rounds: 6 }).success).toBe(false)
    expect(DeriveRequestSchema.safeParse({ ...ok, rounds: 0 }).success).toBe(false)
    expect(DeriveRequestSchema.safeParse({ ...ok, capUsd: 0 }).success).toBe(false)
    expect(DeriveRequestSchema.safeParse({ ...ok, techniques: [] }).success).toBe(false)
    // A derive request may tick the proposal alone (spec 8.5, plan 5).
    expect(DeriveRequestSchema.parse(ok).propose).toBe(false)
    expect(DeriveRequestSchema.safeParse({ ...ok, techniques: [], propose: true }).success).toBe(
      true,
    )
    expect(DeriveRequestSchema.safeParse({ ...ok, techniques: ['ledger-wipe'] }).success).toBe(true)
    expect(DeriveRequestSchema.safeParse({ ...ok, techniques: ['Ledger'] }).success).toBe(false)
    expect(ExemplarSteerSchema.safeParse('a'.repeat(EXEMPLAR_STEER_MAX)).success).toBe(true)
    expect(ExemplarSteerSchema.safeParse('a'.repeat(EXEMPLAR_STEER_MAX + 1)).success).toBe(false)
  })

  it('a technique progress row names a state from the list', () => {
    expect(TECHNIQUE_PROGRESS_STATES).toContain('stopped-at-cap')
    expect(EXEMPLAR_STATUSES).toEqual(['draft', 'approved', 'retired'])
    expect(VERDICT_KINDS).toEqual([
      'approve',
      'keep-approved',
      'prefer',
      'revise',
      'steer',
      'redesign',
    ])
    const row = {
      technique: 'stat-counter',
      state: 'ready',
      versionId: null,
      reason: null,
      costUsd: 0.5,
    }
    expect(TechniqueProgressSchema.safeParse(row).success).toBe(true)
    expect(TechniqueProgressSchema.safeParse({ ...row, state: 'done' }).success).toBe(false)
    // A progress entry carries a channel-only key (plan 5).
    expect(TechniqueProgressSchema.safeParse({ ...row, technique: 'ledger-wipe' }).success).toBe(
      true,
    )
    expect(TechniqueProgressSchema.safeParse({ ...row, technique: 'Ledger' }).success).toBe(false)
    const frames = {
      shots: [{ orientation: 'landscape', atMs: 900, r2Key: 'k' }],
      sheets: { landscape: 'sheet' },
      round: 1,
    }
    expect(ExemplarFramesSchema.safeParse(frames).success).toBe(true)
  })
})

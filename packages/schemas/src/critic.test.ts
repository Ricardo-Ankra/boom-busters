import { describe, expect, it } from 'vitest'
import {
  CRITIC_AXES,
  CRITIC_BAR,
  CRITIC_DEFECTS_MAX,
  CRITIC_FIXES_MAX,
  CriticReportSchema,
  MotionMetricsSchema,
  criticPasses,
} from './critic'

const report = {
  scores: Object.fromEntries(CRITIC_AXES.map((axis) => [axis, { score: 8, line: 'fine' }])),
  defects: [],
  fixes: [],
  mechanisms: [],
  keep: true,
}

describe('CriticReportSchema (spec 2026-11-04, section 10.4)', () => {
  it('names the five axes in order and a bar of eight', () => {
    expect(CRITIC_AXES).toEqual(['engagement', 'intent', 'composition', 'temporal', 'craft'])
    expect(CRITIC_BAR).toBe(8)
    expect(CRITIC_FIXES_MAX).toBe(3)
    expect(CRITIC_DEFECTS_MAX).toBe(8)
  })

  it('accepts a full report and refuses a score past ten or a missing axis', () => {
    expect(CriticReportSchema.safeParse(report).success).toBe(true)
    expect(
      CriticReportSchema.safeParse({
        ...report,
        scores: { ...report.scores, craft: { score: 11, line: 'x' } },
      }).success,
    ).toBe(false)
    const { craft: _craft, ...four } = report.scores
    expect(CriticReportSchema.safeParse({ ...report, scores: four }).success).toBe(false)
  })

  it('passes at the bar on every axis and not one under it', () => {
    expect(criticPasses(CriticReportSchema.parse(report))).toBe(true)
    expect(
      criticPasses(
        CriticReportSchema.parse({
          ...report,
          scores: { ...report.scores, temporal: { score: 7, line: 'late' } },
        }),
      ),
    ).toBe(false)
  })

  it('caps fixes at three and defects at eight, and validates a mechanism key', () => {
    expect(CriticReportSchema.safeParse({ ...report, fixes: ['a', 'b', 'c', 'd'] }).success).toBe(
      false,
    )
    const defect = { atMs: 1350, orientation: 'landscape', text: 'late' }
    expect(
      CriticReportSchema.safeParse({ ...report, defects: Array.from({ length: 9 }, () => defect) })
        .success,
    ).toBe(false)
    expect(CriticReportSchema.safeParse({ ...report, defects: [defect] }).success).toBe(true)
    expect(
      CriticReportSchema.safeParse({
        ...report,
        mechanisms: [{ key: 'jazz-hands', present: true }],
      }).success,
    ).toBe(false)
    expect(
      CriticReportSchema.safeParse({ ...report, mechanisms: [{ key: 'drum', present: false }] })
        .success,
    ).toBe(true)
  })
})

describe('MotionMetricsSchema (spec 2026-11-04, section 10.1)', () => {
  const metrics = {
    frozenMs: 1000,
    longestFrozenMs: 500,
    frozenCritical: false,
    simultaneity: 0.75,
    holdAfterLastMs: 1000,
    speedProfile: [{ atMs: 500, change: 0 }],
  }

  it('holds the measured numbers with simultaneity inside 0 to 1', () => {
    expect(MotionMetricsSchema.safeParse(metrics).success).toBe(true)
    expect(MotionMetricsSchema.safeParse({ ...metrics, simultaneity: 1.2 }).success).toBe(false)
    expect(MotionMetricsSchema.safeParse({ ...metrics, frozenMs: -1 }).success).toBe(false)
  })
})

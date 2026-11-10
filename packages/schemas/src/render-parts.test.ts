import { describe, expect, it } from 'vitest'
import type { LoudnormMeasurement, QcReport } from './broker'
import {
  combineLoudness,
  mergeQcReports,
  partEstimateUsd,
  partsProgressPct,
  partWaves,
  planRenderParts,
  rendersInParts,
  settleRenderParts,
  type RenderPart,
} from './render-parts'
import type { Timeline } from './timeline'

/** Only fps and the narration and slot ends matter to the plan. */
function timelineOf(durationMs: number, fps = 30): Timeline {
  return {
    fps,
    narration: [{ startMs: 0, durationMs }],
    slots: [{ startMs: 0, durationMs }],
  } as unknown as Timeline
}

function measurement(inputI: string, tp = '-1.00', lra = '5.00'): LoudnormMeasurement {
  return {
    input_i: inputI,
    input_tp: tp,
    input_lra: lra,
    input_thresh: '-28.00',
    target_offset: '0.00',
  }
}

const ID = (n: number) => `01HQ00000000000000000${String(n).padStart(5, '0')}`

function partOf(index: number, over: Partial<RenderPart> = {}): RenderPart {
  return {
    index,
    renderId: ID(index),
    frameRange: [index * 27000, index * 27000 + 26999],
    startMs: index * 900000,
    durationMs: 900000,
    status: 'queued',
    attempt: 1,
    priorRenderIds: [],
    ...over,
  }
}

describe('rendersInParts', () => {
  it('renders at or under 30 minutes as one piece', () => {
    expect(rendersInParts(1800)).toBe(false)
    expect(rendersInParts(1801)).toBe(true)
  })
})

describe('planRenderParts', () => {
  it('plans equal parts from the count, the last taking the remainder', () => {
    const plan = planRenderParts(timelineOf(1_860_000))
    expect(plan).toHaveLength(3)
    expect(plan.map((p) => p.frameRange)).toEqual([
      [0, 18599],
      [18600, 37199],
      [37200, 55799],
    ])
    expect(plan.map((p) => p.startMs)).toEqual([0, 620000, 1240000])
    expect(plan[2]?.durationMs).toBe(620000)
  })

  it('plans twelve parts for 180 minutes', () => {
    const plan = planRenderParts(timelineOf(10_800_000))
    expect(plan).toHaveLength(12)
    for (const part of plan) {
      expect(part.frameRange[1] - part.frameRange[0] + 1).toBe(27000)
    }
    expect(plan[11]?.frameRange[1]).toBe(323999)
  })

  it('counts frames as the composition does', () => {
    const plan = planRenderParts(timelineOf(20_017))
    expect(plan).toHaveLength(1)
    expect(plan[0]?.frameRange).toEqual([0, 600])
  })
})

describe('combineLoudness', () => {
  it('combines equal parts to their common value', () => {
    const combined = combineLoudness([
      { measurement: measurement('-18.00', '-2.00', '4.00'), durationMs: 900000 },
      { measurement: measurement('-18.00', '-1.50', '6.00'), durationMs: 900000 },
    ])
    expect(combined.input_i).toBe('-18.00')
    expect(combined.input_tp).toBe('-1.50')
    expect(combined.input_lra).toBe('6.00')
    expect(combined.input_thresh).toBe('-28.00')
    expect(combined.target_offset).toBe('0.00')
  })

  it('a silent part weighs its duration, nothing more', () => {
    const combined = combineLoudness([
      { measurement: measurement('-14.00'), durationMs: 900000 },
      { measurement: measurement('-70.00'), durationMs: 900000 },
    ])
    expect(Number(combined.input_i)).toBeCloseTo(-17.01, 1)
    expect(Number(combined.input_thresh)).toBeCloseTo(Number(combined.input_i) - 10, 2)
  })

  it('returns a single part unchanged except the offset', () => {
    const combined = combineLoudness([
      {
        measurement: { ...measurement('-15.30', '-0.80', '7.10'), target_offset: '0.40' },
        durationMs: 600000,
      },
    ])
    expect(combined).toEqual({
      input_i: '-15.30',
      input_tp: '-0.80',
      input_lra: '7.10',
      input_thresh: '-25.30',
      target_offset: '0.00',
    })
  })
})

describe('mergeQcReports', () => {
  const first: QcReport = {
    passed: false,
    integratedLufs: -14,
    issues: [
      { kind: 'loudness', atMs: 0, detail: 'part loudness' },
      { kind: 'silence', atMs: 5000, durationMs: 3000, detail: '3s of silence' },
    ],
  }
  const second: QcReport = {
    passed: false,
    integratedLufs: -14,
    issues: [{ kind: 'black-frames', atMs: 905000, detail: 'black' }],
  }

  it('merges part issues on the film clock and judges loudness from the join', () => {
    const ok = mergeQcReports([{ qc: second }, { qc: first }], { integratedLufs: -14.4 }, -14)
    expect(ok.issues.map((i) => [i.kind, i.atMs])).toEqual([
      ['silence', 5000],
      ['black-frames', 905000],
    ])
    expect(ok.passed).toBe(false)
    expect(ok.integratedLufs).toBe(-14.4)

    const clean = mergeQcReports([{ qc: { ...first, issues: [] } }], { integratedLufs: -14.4 }, -14)
    expect(clean.passed).toBe(true)

    const off = mergeQcReports([{ qc: first }, { qc: second }], { integratedLufs: -16.2 }, -14)
    expect(off.issues).toHaveLength(3)
    expect(off.issues.filter((i) => i.kind === 'loudness')).toHaveLength(1)
    expect(off.issues.find((i) => i.kind === 'loudness')?.atMs).toBe(0)
    expect(off.passed).toBe(false)

    const unknown = mergeQcReports([{ qc: first }, { qc: second }], { integratedLufs: null }, -14)
    expect(unknown.issues.find((i) => i.kind === 'loudness')?.detail).toBe(
      'integrated loudness could not be measured',
    )
    expect(unknown.integratedLufs).toBe(0)
    expect(unknown.passed).toBe(false)
  })
})

describe('partsProgressPct', () => {
  const twelve = (completed: number) =>
    Array.from({ length: 12 }, (_, i) =>
      partOf(i, { status: i < completed ? 'completed' : 'rendering' }),
    )

  it('weights live progress by part frames and clamps', () => {
    expect(partsProgressPct(twelve(4), { [ID(4)]: 0.4 })).toBe(37)
    expect(partsProgressPct(twelve(4), { [ID(0)]: 0.1 })).toBe(33)
    const wild = Object.fromEntries(twelve(0).map((p) => [p.renderId, 5]))
    expect(partsProgressPct(twelve(0), wild)).toBe(100)
  })
})

describe('settleRenderParts', () => {
  it('settles completed parts at cost and every failed attempt at its share', () => {
    const parts = [
      partOf(0, { status: 'completed', costUsd: 0.93 }),
      partOf(1, { status: 'completed', costUsd: 0.95 }),
      partOf(2, { status: 'completed', costUsd: 0.94, priorRenderIds: [ID(99)] }),
      partOf(3, { status: 'failed' }),
      ...Array.from({ length: 8 }, (_, i) => partOf(i + 4)),
    ]
    const total = 12 * 27000
    expect(partEstimateUsd(11, parts[3] as RenderPart, total)).toBeCloseTo(0.9167, 4)
    expect(settleRenderParts(parts, 11, total)).toBeCloseTo(4.6534, 4)
  })
})

describe('partWaves', () => {
  it('splits into waves', () => {
    expect(partWaves(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })
})

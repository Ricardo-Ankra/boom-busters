import { describe, expect, it } from 'vitest'
import {
  PointPlanShotSchema,
  pointScriptIssues,
  talkingPointSetIssues,
  type TalkingPointDraft,
} from './talking-points'

function point(over: Partial<TalkingPointDraft> = {}): TalkingPointDraft {
  return {
    type: 'forensic-breakdown',
    title: 'The signature',
    question: 'Who signed the order?',
    payoff: 'The order was signed by the deputy, not the chief.',
    bridge: 'The full film shows how the deputy came to hold the pen.',
    bridgeChapters: [1],
    sourceChapters: [0],
    hook: 'One signature changed everything.',
    order: 1,
    ...over,
  }
}

function validSet(): TalkingPointDraft[] {
  return [
    point({ order: 1, sourceChapters: [0] }),
    point({
      order: 2,
      type: 'result-first',
      question: 'Where did the money go?',
      sourceChapters: [1],
    }),
    point({
      order: 3,
      type: 'result-first',
      question: 'Why was nobody charged?',
      sourceChapters: [2],
    }),
  ]
}

describe('talkingPointSetIssues', () => {
  it('is empty for a valid three-point set with two types', () => {
    expect(talkingPointSetIssues(validSet(), 7)).toEqual([])
  })

  it('flags two points', () => {
    expect(talkingPointSetIssues(validSet().slice(0, 2), 7)).toHaveLength(1)
  })

  it('flags six points', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      point({
        order: i + 1,
        type: i % 2 ? 'result-first' : 'forensic-breakdown',
        question: `Question number ${i} here?`,
        sourceChapters: [i],
      }),
    )
    expect(talkingPointSetIssues(six, 7)).toHaveLength(1)
  })

  it('flags a chapter past the end', () => {
    const set = validSet()
    set[0] = point({ order: 1, sourceChapters: [7] })
    expect(talkingPointSetIssues(set, 7)).toHaveLength(1)
    const set2 = validSet()
    set2[0] = point({ order: 1, bridgeChapters: [7] })
    expect(talkingPointSetIssues(set2, 7)).toHaveLength(1)
  })

  it('flags one type only', () => {
    const set = validSet().map((p) => ({ ...p, type: 'forensic-breakdown' as const }))
    expect(talkingPointSetIssues(set, 7)).toHaveLength(1)
  })

  it('flags a duplicate question ignoring case and punctuation', () => {
    const set = validSet()
    set[0] = point({ order: 1, question: 'Who signed?', sourceChapters: [0] })
    set[1] = { ...set[1]!, question: 'who signed' }
    expect(talkingPointSetIssues(set, 7)).toHaveLength(1)
  })

  it('flags a chapter that leads three points', () => {
    const set = validSet().map((p) => ({ ...p, sourceChapters: [2] }))
    expect(talkingPointSetIssues(set, 7)).toHaveLength(1)
  })

  it('flags orders that are not 1..n', () => {
    const set = validSet()
    set[1] = { ...set[1]!, order: 1 }
    expect(talkingPointSetIssues(set, 7)).toHaveLength(1)
  })
})

describe('pointScriptIssues', () => {
  const para = (phase: string, chapterIndex = 0) => ({
    phase: phase as 'hook',
    text: 'A sentence long enough to pass.',
    chapterIndex,
  })
  const full = () => [
    para('hook'),
    para('stakes'),
    para('delivery'),
    para('resolution'),
    para('bridge'),
  ]

  it('is empty for a complete script', () => {
    expect(pointScriptIssues({ title: 'Title', paragraphs: full() }, 3)).toEqual([])
  })

  it('flags a missing bridge', () => {
    const paragraphs = [...full().slice(0, 4), para('resolution')]
    const issues = pointScriptIssues({ title: 'Title', paragraphs }, 3)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('bridge')
  })

  it('flags resolution before delivery', () => {
    const p = full()
    ;[p[2], p[3]] = [p[3]!, p[2]!]
    expect(pointScriptIssues({ title: 'Title', paragraphs: p }, 3).length).toBeGreaterThan(0)
  })

  it('flags a chapter out of range', () => {
    const p = full()
    p[2] = para('delivery', 3)
    expect(pointScriptIssues({ title: 'Title', paragraphs: p }, 3)).toHaveLength(1)
  })
})

describe('PointPlanShotSchema', () => {
  const slot = {
    type: 'still',
    startMs: 0,
    durationMs: 2000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: { kind: 'image', src: { r2Key: 'stills/a.png' } },
  }
  const base = { startWord: 0, crop: 'centre', motion: 'static' }
  const pending = { kind: 'stock', query: 'courtroom' }

  it('accepts a slot shot', () => {
    expect(PointPlanShotSchema.safeParse({ ...base, slot, pending: null }).success).toBe(true)
  })

  it('accepts a pending shot', () => {
    expect(PointPlanShotSchema.safeParse({ ...base, slot: null, pending }).success).toBe(true)
  })

  it('refuses both slot and pending', () => {
    expect(PointPlanShotSchema.safeParse({ ...base, slot, pending }).success).toBe(false)
  })

  it('refuses neither', () => {
    expect(PointPlanShotSchema.safeParse({ ...base, slot: null, pending: null }).success).toBe(
      false,
    )
  })
})

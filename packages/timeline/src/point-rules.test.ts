import type { Timeline } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileShortMaster } from './point'
import { pointFixtureInput } from './point.fixture'
import { checkShortRules } from './point-rules'
import type { RuleFinding } from './point-rules'

const BASE_NEW_IMAGES = 2

function clean() {
  const input = pointFixtureInput()
  return {
    timeline: compileShortMaster(input),
    paragraphs: input.paragraphs.map((p) => ({ text: p.text, phase: p.phase })),
    newImageCount: BASE_NEW_IMAGES,
  }
}

/** Lengthen (or shorten) one narration paragraph and move the later ones with it. */
function stretch(timeline: Timeline, index: number, extraMs: number): Timeline {
  const copy = structuredClone(timeline)
  copy.narration.forEach((segment, i) => {
    if (i === index) segment.durationMs += extraMs
    if (i > index) segment.startMs += extraMs
  })
  return copy
}

function only(findings: RuleFinding[], rule: RuleFinding['rule']): RuleFinding {
  expect(findings.map((f) => f.rule)).toEqual([rule])
  return findings[0]!
}

describe('checkShortRules', () => {
  it('finds nothing in the fixture Short', () => {
    expect(checkShortRules(clean())).toEqual([])
  })

  it('flags too many words, with the count', () => {
    const base = clean()
    const extra = ' ' + Array.from({ length: 21 }, () => 'more').join(' ')
    const paragraphs = base.paragraphs.map((p) =>
      p.phase === 'resolution' ? { ...p, text: p.text + extra } : p,
    )
    // Keep the pace in range so only the count is wrong.
    const finding = only(
      checkShortRules({ ...base, paragraphs, timeline: stretch(base.timeline, 3, 4800) }),
      'words',
    )
    expect(finding.message).toContain('161 words')
  })

  it('flags too few words, with the count', () => {
    const base = clean()
    const paragraphs = base.paragraphs.map((p) =>
      p.phase === 'delivery' ? { ...p, text: 'Only a few words here.' } : p,
    )
    const words = checkShortRules({ ...base, paragraphs }).filter((f) => f.rule === 'words')
    expect(words).toHaveLength(1)
    expect(words[0]!.message).toContain('words')
  })

  it('flags a runtime over the limit', () => {
    const base = clean()
    // A Short that ends past 60 s also ends its bridge past 60 s.
    const findings = checkShortRules({ ...base, timeline: stretch(base.timeline, 4, 8000) })
    const runtime = findings.filter((f) => f.rule === 'runtime')
    expect(runtime).toHaveLength(1)
    expect(runtime[0]!.message).toContain('60.7 s')
  })

  it('flags a runtime under the limit', () => {
    const base = clean()
    const findings = checkShortRules({ ...base, timeline: stretch(base.timeline, 2, -9000) })
    const runtime = findings.filter((f) => f.rule === 'runtime')
    expect(runtime).toHaveLength(1)
    expect(runtime[0]!.message).toContain('43.7 s')
  })

  it('flags narration that is too slow', () => {
    const base = clean()
    const finding = only(
      checkShortRules({ ...base, timeline: stretch(base.timeline, 3, 4800) }),
      'pace',
    )
    expect(finding.message).toContain('148 words a minute')
  })

  it('flags narration that is too fast', () => {
    const base = clean()
    const extra = ' ' + Array.from({ length: 16 }, () => 'more').join(' ')
    const paragraphs = base.paragraphs.map((p) =>
      p.phase === 'delivery' ? { ...p, text: p.text + extra } : p,
    )
    const finding = only(checkShortRules({ ...base, paragraphs }), 'pace')
    expect(finding.message).toContain('180 words a minute')
  })

  it('flags a phase that runs past its done-by time', () => {
    const base = clean()
    const finding = only(
      checkShortRules({ ...base, timeline: stretch(base.timeline, 0, 800) }),
      'phase-timing',
    )
    expect(finding.phase).toBe('hook')
    expect(finding.message).toBe('The hook runs 3.4 s; the rule book wants it done by 3 s')
  })

  it('flags a shot that holds too long', () => {
    const base = clean()
    const timeline = structuredClone(base.timeline)
    timeline.slots[3]!.durationMs = 3800
    const finding = only(checkShortRules({ ...base, timeline }), 'shot-length')
    expect(finding.shotIndex).toBe(3)
    expect(finding.message).toContain('3.8 s')
  })

  it('flags a shot that is too brief', () => {
    const base = clean()
    const timeline = structuredClone(base.timeline)
    timeline.slots[2]!.durationMs = 1000
    const finding = only(checkShortRules({ ...base, timeline }), 'shot-length')
    expect(finding.shotIndex).toBe(2)
    expect(finding.message).toContain('1.0 s')
  })

  it('lets a chart card hold to 4.5 s but not beyond', () => {
    const base = clean()
    const chart = base.timeline.slots.findIndex((slot) => slot.type === 'chart')
    expect(chart).toBeGreaterThan(0)
    const ok = structuredClone(base.timeline)
    ok.slots[chart]!.durationMs = 4000
    expect(checkShortRules({ ...base, timeline: ok })).toEqual([])
    const long = structuredClone(base.timeline)
    long.slots[chart]!.durationMs = 4600
    const finding = only(checkShortRules({ ...base, timeline: long }), 'shot-length')
    expect(finding.shotIndex).toBe(chart)
    expect(finding.message).toContain('4.6 s')
  })

  it('does not hold the last shot to the minimum', () => {
    const base = clean()
    const timeline = structuredClone(base.timeline)
    timeline.slots[timeline.slots.length - 1]!.durationMs = 500
    expect(checkShortRules({ ...base, timeline })).toEqual([])
  })

  it('flags a hook shot with no punch-in by 1.2 s', () => {
    const base = clean()
    const timeline = structuredClone(base.timeline)
    // The fixture has a later punch (not in the first 1.2 s); it must not count.
    timeline.slots[0]!.motion = { kind: 'static' }
    expect(timeline.slots.some((s, i) => i > 0 && s.motion.kind === 'punch')).toBe(true)
    const finding = only(checkShortRules({ ...base, timeline }), 'hook-punch')
    expect(finding.message).toContain('1.2 s')
  })

  it('flags a bridge that runs long', () => {
    const base = clean()
    const finding = only(
      checkShortRules({ ...base, timeline: stretch(base.timeline, 4, 2500) }),
      'bridge-length',
    )
    expect(finding.phase).toBe('bridge')
    expect(finding.message).toContain('8.5 s')
  })

  it('flags a bridge that is too short', () => {
    const base = clean()
    const finding = only(
      checkShortRules({ ...base, timeline: stretch(base.timeline, 4, -1500) }),
      'bridge-length',
    )
    expect(finding.message).toContain('4.5 s')
  })

  it('flags a dissolve', () => {
    const base = clean()
    const timeline = structuredClone(base.timeline)
    timeline.slots[5]!.transition = 'dissolve'
    const finding = only(checkShortRules({ ...base, timeline }), 'transition')
    expect(finding.shotIndex).toBe(5)
    expect(finding.message).toContain('dissolve')
  })

  it('flags too many new images', () => {
    const base = clean()
    const finding = only(checkShortRules({ ...base, newImageCount: 5 }), 'new-images')
    expect(finding.message).toContain('5 new images')
  })

  it('never throws on an empty Short', () => {
    const base = clean()
    const timeline = { ...structuredClone(base.timeline), narration: [], slots: [] }
    expect(() => checkShortRules({ timeline, paragraphs: [], newImageCount: 0 })).not.toThrow()
  })
})

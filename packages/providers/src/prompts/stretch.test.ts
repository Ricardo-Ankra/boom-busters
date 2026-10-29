import { MIN_SHOT_SECONDS, ShotListOutputSchema, FIRST_CHANNEL_IN_USE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildShotListRequest } from './shotlist'
import { buildStretchRequest, MIN_SHOT_RULE, mockStretchPlan } from './stretch'
import type { StretchRequestInput } from './stretch'
import { MAX_OUTPUT_TOKENS } from '../llm/types'

const base = {
  ...buildShotListRequest({
    bible: FIRST_CHANNEL_IN_USE,
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: [{ index: 0, text: 'Other tallies went higher. In 2021, it rose.', seconds: 9 }],
    claims: [],
  }),
  cacheablePrefixMessages: 1,
}

const input: StretchRequestInput = {
  bible: FIRST_CHANNEL_IN_USE,
  pieces: [
    { paragraphIndex: 0, text: 'Other tallies went higher. In 2021, it rose.', seconds: 9 },
    { paragraphIndex: 1, text: 'Then it fell.', seconds: 3.4 },
  ],
  opening: 'Other tallies went higher. In 2021,',
  before: { type: 'stock', coversText: 'Before.' },
  after: null,
  headlineAllowed: true,
  note: 'keep the headline card up through the CNBC line',
}

describe('buildStretchRequest', () => {
  it('appends the stretch to the chapter request and keeps its prefix', () => {
    const req = buildStretchRequest(base, input)
    expect(req.messages.slice(0, base.messages.length)).toEqual(base.messages)
    expect(req.messages).toHaveLength(base.messages.length + 1)
    expect(req.cacheablePrefixMessages).toBe(base.cacheablePrefixMessages)
    expect(req.system).toBe(base.system)
    expect(req.maxTokens).toBeGreaterThan(0)
    expect(req.maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS)
    const last = req.messages.at(-1)!.content
    expect(last).toContain('[paragraph 0, 9s]')
    expect(last).toContain('[paragraph 1, 3s]')
    expect(last).toContain('must start with "Other tallies went higher. In 2021,"')
    expect(last).toContain("Producer's note: keep the headline card up through the CNBC line")
    expect(last).toContain(MIN_SHOT_RULE)
    expect(last).toContain('{"type":"stock","coversText":"Before."}')
    expect(last).toContain('Return JSON: {"slots": [...]}')
    expect(last).not.toContain('Why:')
    expect(last).not.toContain('Do not plan a headline shot.')
  })

  it('forbids a headline when the chapter already has one', () => {
    const last = buildStretchRequest(base, { ...input, headlineAllowed: false }).messages.at(-1)!
    expect(last.content).toContain('Do not plan a headline shot.')
  })

  it('says why when the app re-plans unasked, and omits the note when absent', () => {
    const { note: _note, ...rest } = input
    const last = buildStretchRequest(base, {
      ...rest,
      reason: 'two shots quote one sentence',
    }).messages.at(-1)!
    expect(last.content).toContain('Why: two shots quote one sentence')
    expect(last.content).not.toContain("Producer's note")
  })
})

describe('MIN_SHOT_RULE', () => {
  it('is derived from the minimums', () => {
    expect(MIN_SHOT_RULE).toBe(
      '- Once timed, a slot must stay on screen at least: headline and social 5 seconds, chart and map 4, every other type 3.',
    )
    expect(MIN_SHOT_SECONDS.headline).toBe(5)
  })
})

describe('mockStretchPlan', () => {
  it('mocks a stretch as at most two slots, the first quoting the opening', () => {
    const { slots } = mockStretchPlan(input)
    expect(() => ShotListOutputSchema.parse({ slots })).not.toThrow()
    expect(slots).toHaveLength(2)
    expect(slots[0]!.brief.coversText.startsWith('Other tallies went higher.')).toBe(true)
    const total = slots.reduce((sum, slot) => sum + slot.seconds, 0)
    expect(total).toBeCloseTo(12.4, 5)
  })

  it('keeps each quote inside one piece when the stretch has two or more', () => {
    const { slots } = mockStretchPlan(input)
    expect(slots.map((slot) => slot.brief.coversText)).toEqual([
      'Other tallies went higher. In 2021, it rose.',
      'Then it fell.',
    ])
    expect(slots.map((slot) => slot.paragraphIndex)).toEqual([0, 1])
    expect(slots[0]!.seconds).toBe(9)
    expect(slots[1]!.seconds).toBeCloseTo(3.4, 5)
  })

  it('splits a one-piece stretch after its first sentence', () => {
    const { slots } = mockStretchPlan({ pieces: [input.pieces[0]!] })
    expect(slots.map((slot) => slot.brief.coversText)).toEqual([
      'Other tallies went higher.',
      'In 2021, it rose.',
    ])
    expect(slots.reduce((sum, slot) => sum + slot.seconds, 0)).toBeCloseTo(9, 5)
  })

  it('plans one slot for a one-sentence stretch, in the piece it starts in', () => {
    const { slots } = mockStretchPlan({
      pieces: [{ paragraphIndex: 4, text: 'Just this.', seconds: 5 }],
    })
    expect(slots).toHaveLength(1)
    expect(slots[0]).toMatchObject({ paragraphIndex: 4, seconds: 5 })
  })
})

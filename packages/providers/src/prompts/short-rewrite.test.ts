import { FIRST_CHANNEL_IN_USE, SHORT_PHASES, ValidationError } from '@boom-busters/schemas'
import type { PointScript, TalkingPoint, TeaserScript } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildPointScriptRequest } from './point-script'
import {
  buildShortRewriteRequest,
  mockShortRewrite,
  parsePointRewrite,
  parseTeaserRewrite,
  rewriteShapeIssue,
} from './short-rewrite'

const chapters = [
  { index: 0, title: 'The audit', contentMd: 'By June, the auditors could not find the money.' },
  { index: 1, title: 'The collapse', contentMd: 'The shares collapsed in nine days.' },
  { index: 2, title: 'The trial', contentMd: 'The court heard the accounts were falsified.' },
]
const point: TalkingPoint = {
  id: '01ABCDEFGHJKMNPQRSTVWXYZ01',
  type: 'forensic-breakdown',
  title: 'The missing billion',
  question: 'Where did the billion go?',
  payoff: 'It never existed in the first place.',
  bridge: 'The trial shows how the accounts were built.',
  bridgeChapters: [2],
  sourceChapters: [0, 1],
  hook: 'A billion euros, and no trace of it.',
  order: 1,
}

const pointParagraphs = (word: string): PointScript['paragraphs'] =>
  SHORT_PHASES.map((phase, i) => ({
    phase,
    text: `This is the ${word} ${phase} paragraph of the Short, said plainly.`,
    chapterIndex: phase === 'bridge' ? 2 : i % 2,
  }))

const teaserBeats = (word: string): TeaserScript['paragraphs'] => [
  { text: `The ${word} cold open, mid-action and plain.`, chapterIndex: 0 },
  { text: `The ${word} escalation raises the stakes.`, chapterIndex: 1 },
  { text: `The ${word} cliffhanger leaves the question open?`, chapterIndex: 2 },
]

const answer = (paragraphs: readonly unknown[]) =>
  JSON.stringify({ title: 'The missing billion', paragraphs })

const base = buildPointScriptRequest({
  bible: FIRST_CHANNEL_IN_USE,
  caseTitle: 'The case',
  point,
  chapters,
  ctaLine: null,
})

describe('buildShortRewriteRequest', () => {
  it("keeps the writer's system prompt and adds the script, the note and the scope last", () => {
    const request = buildShortRewriteRequest({
      base,
      current: { title: 'Old title', paragraphs: pointParagraphs('old') },
      note: 'open on the billion',
      target: 1,
      keepShape: false,
    })
    expect(request.system).toBe(base.system)
    expect(request.maxTokens).toBe(base.maxTokens)
    expect(request.messages).toHaveLength(base.messages.length + 1)
    const last = request.messages.at(-1)!.content as string
    expect(last).toContain('This is the old hook paragraph')
    expect(last).toContain("The owner's note: open on the billion")
    expect(last).toContain('Rewrite only paragraph 2 (the stakes paragraph)')
    expect(last).toContain('every other paragraph exactly as it is')
  })

  it('asks for a fresh take when the note is empty', () => {
    const request = buildShortRewriteRequest({
      base,
      current: { title: 'Old', paragraphs: teaserBeats('old') },
      note: '   ',
      target: null,
      keepShape: true,
    })
    const last = request.messages.at(-1)!.content as string
    expect(last).toContain("The owner's note: none.")
    expect(last).toContain('Keep exactly 3 paragraphs')
  })

  it('lets a whole point rewrite restructure', () => {
    const request = buildShortRewriteRequest({
      base,
      current: { title: 'Old', paragraphs: pointParagraphs('old') },
      note: 'tighter',
      target: null,
      keepShape: false,
    })
    expect(request.messages.at(-1)!.content).toContain(
      'You may change how the paragraphs are divided',
    )
  })
})

describe('parsePointRewrite', () => {
  const current = pointParagraphs('old')

  it('takes only the target paragraph and keeps the rest word for word', () => {
    const given = pointParagraphs('new')
    const result = parsePointRewrite(answer(given), { current, target: 2, chapterCount: 3 })
    expect(result[2]!.text).toBe(given[2]!.text)
    expect(result.filter((_, index) => index !== 2)).toEqual(
      current.filter((_, index) => index !== 2),
    )
  })

  it('refuses a one-paragraph answer that changed the paragraph count', () => {
    const given = [...pointParagraphs('new'), { ...pointParagraphs('new')[2]! }]
    // Six paragraphs is a valid script, but not this rewrite.
    const reordered = [given[0], given[1], given[2], given[5], given[3], given[4]]
    expect(() =>
      parsePointRewrite(answer(reordered), { current, target: 0, chapterCount: 3 }),
    ).toThrow(/must keep the 5 paragraphs/)
  })

  it('accepts a whole rewrite that divides the paragraphs differently', () => {
    const given = pointParagraphs('new')
    const split = [
      given[0],
      given[1],
      given[2],
      { ...given[2]!, text: 'A second delivery paragraph, short.' },
      given[3],
      given[4],
    ]
    const result = parsePointRewrite(answer(split), { current, target: null, chapterCount: 3 })
    expect(result).toHaveLength(6)
  })

  it('refuses a target that is not in the script', () => {
    expect(() =>
      parsePointRewrite(answer(pointParagraphs('new')), { current, target: 9, chapterCount: 3 }),
    ).toThrow(ValidationError)
  })
})

describe('parseTeaserRewrite', () => {
  const current = teaserBeats('old')

  it('keeps the beats on their chapters with new words', () => {
    const result = parseTeaserRewrite(answer(teaserBeats('new')), {
      current,
      target: null,
      chapterCount: 3,
    })
    expect(result.map((beat) => beat.text)).toEqual(teaserBeats('new').map((beat) => beat.text))
    expect(result.map((beat) => beat.chapterIndex)).toEqual([0, 1, 2])
  })

  it('refuses a beat moved to another chapter', () => {
    const moved = teaserBeats('new').map((beat, index) =>
      index === 1 ? { ...beat, chapterIndex: 0 } : beat,
    )
    expect(() =>
      parseTeaserRewrite(answer(moved), { current, target: null, chapterCount: 3 }),
    ).toThrow(/must stay on chapter 1/)
  })
})

describe('rewriteShapeIssue', () => {
  it('checks only the target paragraph for a one-paragraph rewrite', () => {
    const current = pointParagraphs('old')
    const given = current.map((paragraph, index) =>
      index === 4 ? { ...paragraph, phase: 'hook' } : paragraph,
    )
    expect(rewriteShapeIssue(current, given, 0, false)).toBeNull()
    expect(rewriteShapeIssue(current, given, 4, false)).toMatch(/must stay the bridge paragraph/)
  })
})

describe('mockShortRewrite', () => {
  it('marks only the target, or every paragraph for a whole rewrite', () => {
    const current = teaserBeats('old')
    expect(mockShortRewrite(current, 1).map((beat) => beat.text.startsWith('MOCK'))).toEqual([
      false,
      true,
      false,
    ])
    expect(mockShortRewrite(current, null).every((beat) => beat.text.startsWith('MOCK'))).toBe(true)
  })
})

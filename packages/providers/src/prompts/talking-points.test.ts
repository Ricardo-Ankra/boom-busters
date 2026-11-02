import {
  FIRST_CHANNEL_IN_USE,
  SHORT_TYPES,
  ValidationError,
  talkingPointSetIssues,
} from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildTalkingPointsRequest, mockTalkingPoints, parseTalkingPoints } from './talking-points'
import type { Note, Repair } from './repair'

const chapters = [
  { index: 0, title: 'The audit', contentMd: 'By June, the auditors could not find the money.' },
  { index: 1, title: 'The collapse', contentMd: 'The shares collapsed in nine days.' },
  { index: 2, title: 'The trial', contentMd: 'The court heard the accounts were falsified.' },
]
const claims = ['The auditors could not confirm the balances.', 'The shares fell in nine days.']

const point = (n: number, over: Record<string, unknown> = {}) => ({
  type: SHORT_TYPES[n % 2],
  title: `Point ${n} title`,
  question: `What was the question number ${n} about?`,
  payoff: `The script states the answer to question ${n}.`,
  bridge: `The long form shows what happened next in point ${n}.`,
  bridgeChapters: [2],
  sourceChapters: [n % 3],
  hook: `Hook line for point ${n}`,
  order: n,
  ...over,
})
const answer = (count: number) =>
  JSON.stringify({ points: Array.from({ length: count }, (_, i) => point(i + 1)) })
const collect = () => {
  const notes: Repair[] = []
  const note: Note = (repair) => {
    notes.push(repair)
  }
  return { notes, note }
}
const current = [
  { id: '01ABCDEFGHJKMNPQRSTVWXYZ01', ...point(1) },
  { id: '01ABCDEFGHJKMNPQRSTVWXYZ02', ...point(2) },
] as TalkingPoint[]
const build = (redo?: Parameters<typeof buildTalkingPointsRequest>[0]['redo']) =>
  buildTalkingPointsRequest({
    bible: FIRST_CHANNEL_IN_USE,
    caseTitle: 'Wirecard',
    chapters,
    claims,
    ...(redo ? { redo } : {}),
  })
const flat = (r: ReturnType<typeof build>) =>
  [r.system, ...r.messages.map((m) => m.content)].join('\n').replace(/\s+/g, ' ')

describe('the talking-points request', () => {
  it('names every type and states the rules', () => {
    const text = flat(build())
    for (const type of SHORT_TYPES) expect(text).toContain(type)
    expect(text).toContain('Every fact')
    expect(text).toContain('only what')
    expect(text).toContain('the payoff must be something the script states')
    expect(text).toContain('The shares collapsed in nine days.')
    expect(text).toContain('The auditors could not confirm the balances.')
  })

  it('carries the note and the current points in all mode', () => {
    const text = flat(build({ mode: 'all', note: 'Lead with the audit', current }))
    expect(text).toContain('Lead with the audit')
    expect(text).toContain('Point 1 title')
    expect(text).toContain('Point 2 title')
  })

  it('names the point to replace in one mode', () => {
    const text = flat(
      build({ mode: 'one', pointId: '01ABCDEFGHJKMNPQRSTVWXYZ02', note: 'Sharper', current }),
    )
    expect(text).toContain('Replace only the point with id 01ABCDEFGHJKMNPQRSTVWXYZ02')
    expect(text).toContain('Sharper')
    expect(text).toContain('Point 1 title')
  })

  it('asks for one new point in add mode', () => {
    const text = flat(build({ mode: 'add', note: null, current }))
    expect(text).toContain('Add one new point')
    expect(text).toContain('Point 2 title')
  })
})

describe('parseTalkingPoints', () => {
  it('reads a valid set as written, noting nothing', () => {
    const { notes, note } = collect()
    const points = parseTalkingPoints(answer(4), 3, 'set', note)
    expect(points).toHaveLength(4)
    expect(notes).toEqual([])
  })

  it('caps six points at five with a repair note', () => {
    const { notes, note } = collect()
    const points = parseTalkingPoints(answer(6), 3, 'set', note)
    expect(points).toHaveLength(5)
    expect(notes).toContainEqual({ action: 'capped', field: 'talking points', kept: 5 })
  })

  it('trims an over-long field at a sentence', () => {
    const { notes, note } = collect()
    const long = JSON.stringify({
      points: [
        point(1, { payoff: 'The answer is stated plainly. '.repeat(30) }),
        point(2),
        point(3),
      ],
    })
    const points = parseTalkingPoints(long, 3, 'set', note)
    expect(points[0]!.payoff.length).toBeLessThanOrEqual(400)
    expect(notes).toContainEqual({ action: 'trimmed', field: 'point 1 payoff' })
  })

  it('refuses a set of one type, naming the issue', () => {
    const same = JSON.stringify({
      points: [1, 2, 3].map((n) => point(n, { type: 'result-first' })),
    })
    expect(() => parseTalkingPoints(same, 3, 'set')).toThrow(/at least two different types/)
    expect(() => parseTalkingPoints(same, 3, 'set')).toThrow(ValidationError)
  })

  it('refuses a chapter the film does not have', () => {
    expect(() => parseTalkingPoints(answer(3), 2, 'set')).toThrow(/past the last chapter/)
  })

  it('returns one point in single mode and skips set issues', () => {
    const one = JSON.stringify({ points: [point(1)] })
    expect(parseTalkingPoints(one, 3, 'single')).toHaveLength(1)
    expect(() => parseTalkingPoints(one, 3, 'set')).toThrow(/talking points; the set needs/)
  })

  it('still refuses a chapter past the end in single mode', () => {
    const one = JSON.stringify({ points: [point(1, { sourceChapters: [9] })] })
    expect(() => parseTalkingPoints(one, 3, 'single')).toThrow(/past the last chapter/)
  })
})

describe('mockTalkingPoints', () => {
  it('is deterministic and passes its own parser', () => {
    const points = mockTalkingPoints(chapters)
    expect(points).toEqual(mockTalkingPoints(chapters))
    expect(points.map((p) => p.type)).toEqual([
      'forensic-breakdown',
      'contrarian-thesis',
      'result-first',
    ])
    expect(points.map((p) => p.order)).toEqual([1, 2, 3])
    for (const p of points) expect(p.title.startsWith('MOCK POINT')).toBe(true)
    expect(talkingPointSetIssues(points, chapters.length)).toEqual([])
    expect(parseTalkingPoints(JSON.stringify({ points }), chapters.length, 'set')).toEqual(points)
  })

  it('keeps every chapter index inside a two-chapter film', () => {
    const two = chapters.slice(0, 2)
    for (const p of mockTalkingPoints(two)) {
      expect([...p.sourceChapters, ...p.bridgeChapters].every((c) => c < 2)).toBe(true)
    }
  })
})

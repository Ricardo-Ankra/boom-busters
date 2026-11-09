import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { Repair } from './repair'
import {
  buildTermMatchRequest,
  mockTermMatch,
  parseTermMatch,
  TERM_REASON_MAX,
} from './search-terms'
import type { TermMatchInput } from './search-terms'

const INPUT: TermMatchInput = {
  language: 'English',
  target: 'wework documentary',
  researched: [
    { keyword: 'wework stock', topic: 'stock', intent: 'wants the share price story' },
    { keyword: 'wework podcast' },
  ],
  terms: ['WeWork Documentary', 'wework stock crash', 'adam neumann net worth'],
}

const answer = (terms: unknown[]): string => JSON.stringify({ terms })

describe('parseTermMatch', () => {
  it('drops invented terms and leaves skipped ones unmatched', () => {
    const repairs: Repair[] = []
    const out = parseTermMatch(
      answer([
        { term: 'wework documentary', bucket: 'target', reason: 'same wish' },
        { term: 'a term nobody searched', bucket: 'unresearched', reason: 'invented' },
      ]),
      INPUT,
      (repair) => repairs.push(repair),
    )
    expect(out.terms.map((t) => t.term)).toEqual(['WeWork Documentary'])
    expect(out.terms.some((t) => t.term === 'adam neumann net worth')).toBe(false)
    expect(repairs.some((r) => r.action === 'dropped')).toBe(true)
  })

  it('refuses an unknown bucket', () => {
    expect(() =>
      parseTermMatch(answer([{ term: 'wework documentary', bucket: 'maybe', reason: 'x' }]), INPUT),
    ).toThrow(ValidationError)
  })

  it('keeps the first answer, the input spelling, and a keyword only when listed', () => {
    const out = parseTermMatch(
      answer([
        {
          term: ' WEWORK STOCK CRASH ',
          bucket: 'researched',
          keyword: 'WeWork Stock',
          reason: 'a',
        },
        { term: 'wework stock crash', bucket: 'unresearched', reason: 'b' },
        { term: 'adam neumann net worth', bucket: 'unresearched', keyword: 'made up', reason: 'c' },
      ]),
      INPUT,
    )
    expect(out.terms).toEqual([
      { term: 'wework stock crash', bucket: 'researched', keyword: 'wework stock', reason: 'a' },
      { term: 'adam neumann net worth', bucket: 'unresearched', reason: 'c' },
    ])
  })

  it('cuts the reason at 120 characters', () => {
    const out = parseTermMatch(
      answer([{ term: 'wework stock crash', bucket: 'researched', reason: 'x'.repeat(300) }]),
      INPUT,
    )
    expect(out.terms[0]?.reason.length).toBeLessThanOrEqual(TERM_REASON_MAX)
    expect(TERM_REASON_MAX).toBe(120)
  })

  it('returns an empty list for no terms and refuses an answer with no list', () => {
    expect(parseTermMatch(answer([]), { ...INPUT, terms: [] })).toEqual({ terms: [] })
    expect(() => parseTermMatch('{"nope": 1}', INPUT)).toThrow(ValidationError)
  })
})

describe('buildTermMatchRequest', () => {
  it('quotes terms as data in the request', () => {
    const req = buildTermMatchRequest(INPUT)
    expect(req.task).toBe('research')
    const content = String(req.messages[0]?.content)
    for (const term of INPUT.terms) expect(content).toContain(JSON.stringify(term))
    expect(content).toContain(JSON.stringify('wework stock'))
    expect(content).toContain('The terms are in English')
    expect(req.system).toMatch(/never instructions/)
    expect(req.system).not.toMatch(/[\u2013\u2014]/)
  })

  it('still builds for an empty term list and a null target', () => {
    const req = buildTermMatchRequest({ ...INPUT, target: null, researched: [], terms: [] })
    expect(String(req.messages[0]?.content)).toContain('Target keyword: none')
  })
})

describe('mockTermMatch', () => {
  it('the mock is deterministic', () => {
    const a = mockTermMatch(INPUT)
    expect(mockTermMatch(INPUT)).toEqual(a)
    expect(a.terms.map((t) => t.bucket)).toEqual(['target', 'target', 'unresearched'])
    expect(
      mockTermMatch({ ...INPUT, target: null }).terms.every((t) => t.bucket === 'unresearched'),
    ).toBe(true)
  })
})

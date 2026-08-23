import { describe, expect, it } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import {
  buildTitlesRequest,
  mockTitleOptions,
  parseTitleOptions,
  TITLE_OPTION_COUNT,
} from './metadata'

describe('buildTitlesRequest', () => {
  const request = buildTitlesRequest({
    caseTitle: 'Wirecard',
    hook: 'On a June morning in 2020, 1.9 billion euros stopped existing.',
    target: 'master',
    workingTitle: 'Wirecard: The 1.9 Billion Euro Lie',
  })

  it('is a metadata task asking for exactly the option count', () => {
    expect(request.task).toBe('metadata')
    expect(request.system).toContain(`exactly ${TITLE_OPTION_COUNT} strings`)
  })

  it('carries the case, the working title and the hook', () => {
    const content = request.messages.map((m) => m.content).join('\n')
    expect(content).toContain('Wirecard')
    expect(content).toContain('1.9 billion euros stopped existing')
  })

  it('tells the model when the titles are for a Short', () => {
    const short = buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: 'hook',
      target: 'short',
      workingTitle: 'title',
    })
    expect(short.system).toContain('vertical Short')
    expect(request.system).not.toContain('vertical Short')
  })
})

describe('parseTitleOptions', () => {
  it('parses a clean JSON answer', () => {
    const text = JSON.stringify({ titles: ['How Wirecard Fell', 'Nine Days to Zero'] })
    expect(parseTitleOptions(text)).toEqual(['How Wirecard Fell', 'Nine Days to Zero'])
  })

  it('strips list numbering and wrapping quotes without touching real digits', () => {
    const text = JSON.stringify({
      titles: ['1. How Wirecard Fell', '"Nine Days to Zero"', '9 Days That Ended Wirecard'],
    })
    expect(parseTitleOptions(text)).toEqual([
      'How Wirecard Fell',
      'Nine Days to Zero',
      '9 Days That Ended Wirecard',
    ])
  })

  it('drops overlong titles, dedupes case-insensitively and caps at 10', () => {
    const text = JSON.stringify({
      titles: [
        'x'.repeat(101),
        'How Wirecard Fell',
        'HOW WIRECARD FELL',
        ...Array.from({ length: 12 }, (_, i) => `Title ${i}`),
      ],
    })
    const titles = parseTitleOptions(text)
    expect(titles).toHaveLength(10)
    expect(titles[0]).toBe('How Wirecard Fell')
    expect(titles.filter((t) => t.toLowerCase() === 'how wirecard fell')).toHaveLength(1)
  })

  it('throws when nothing in the answer is usable', () => {
    expect(() => parseTitleOptions(JSON.stringify({ titles: ['x'.repeat(200)] }))).toThrow(
      ValidationError,
    )
    expect(() => parseTitleOptions('no json here at all')).toThrow(ValidationError)
  })
})

describe('mockTitleOptions', () => {
  it('is deterministic, obviously mock, and fills the radio list', () => {
    const titles = mockTitleOptions('Wirecard: The 1.9 Billion Euro Lie')
    expect(titles).toEqual(mockTitleOptions('Wirecard: The 1.9 Billion Euro Lie'))
    expect(titles).toHaveLength(TITLE_OPTION_COUNT)
    for (const title of titles) {
      expect(title.startsWith('[mock]')).toBe(true)
      expect(title.length).toBeLessThanOrEqual(100)
    }
  })
})

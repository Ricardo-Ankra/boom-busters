import type { StillBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockDirectorsBook } from './direction'
import { buildRedirectRequest, mockRedirectedBrief, parseRedirectedBrief } from './redirect'

const brief: StillBrief = {
  type: 'still',
  coversText: 'Braun took the stage.',
  description: 'The chief executive at the results presentation.',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Markus Braun at a podium, 50mm, one spotlight.',
  depicts: ['Markus Braun'],
  shotSize: 'medium',
}

describe('buildRedirectRequest', () => {
  const request = buildRedirectRequest({
    caseTitle: 'Wirecard',
    brief,
    reason: 'google: SAFETY',
    direction: mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1 }),
  })

  it('asks for the same beat without the person, on the shot-list task', () => {
    expect(request.task).toBe('shotlist')
    expect(request.system).toContain('without the person')
    expect(request.system).toContain('# Direction craft')
  })

  it('shows the refusal and the current brief, with the book in the prefix', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain("Director's book:")
    expect(request.messages[1]?.content).toContain('google: SAFETY')
    expect(request.messages[1]?.content).toContain('Braun took the stage.')
  })
})

describe('parseRedirectedBrief', () => {
  it('keeps coversText and strips depicts', () => {
    const redirected = mockRedirectedBrief(brief)
    const parsed = parseRedirectedBrief(JSON.stringify({ brief: redirected }), brief)
    expect(parsed.coversText).toBe(brief.coversText)
    expect(parsed.depicts).toBeUndefined()
    expect(parsed.shotSize).toBe('medium')
  })

  it('refuses a redirect that still names the person', () => {
    const bad = { ...mockRedirectedBrief(brief), depicts: ['Markus Braun'] }
    expect(() => parseRedirectedBrief(JSON.stringify({ brief: bad }), brief)).toThrow(
      /still depicts/,
    )
  })

  it('refuses a redirect that moved to another sentence', () => {
    const bad = { ...mockRedirectedBrief(brief), coversText: 'Something else.' }
    expect(() => parseRedirectedBrief(JSON.stringify({ brief: bad }), brief)).toThrow(
      /changed the sentence/,
    )
  })
})

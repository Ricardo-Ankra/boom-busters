import { describe, expect, it } from 'vitest'
import { teaserStillPrompt } from './teaser-still'

describe('teaserStillPrompt', () => {
  it('appends the vertical framing clause and the anchors once', () => {
    const prompt = teaserStillPrompt(
      'An empty podium under one light.',
      'subtle film grain; muted grade',
    )
    expect(prompt).toContain('An empty podium under one light.')
    expect(prompt).toContain('Vertical 9:16 frame')
    expect(prompt).toContain('subtle film grain; muted grade')
    expect(teaserStillPrompt(prompt, 'subtle film grain; muted grade')).toBe(prompt)
  })

  it('trims what it is given', () => {
    expect(teaserStillPrompt('  a  ', ' b ')).toMatch(/^a Vertical 9:16 frame.* b$/)
  })
})

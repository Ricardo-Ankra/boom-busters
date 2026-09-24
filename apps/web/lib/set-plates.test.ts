import { HOUSE_PHOTOGRAPH } from '@boom-busters/providers'
import { describe, expect, it } from 'vitest'
import { buildSetSheetPrompt, setPlateBrief } from './set-plates'

describe('setPlateBrief', () => {
  it('asks for a photograph, then the Brand Kit anchors', () => {
    const brief = setPlateBrief(
      { name: 'R', look: 'A long table', plates: [] },
      'north',
      'fine grain',
    )
    expect(brief.prompt).toBe(
      `R, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level. A long table ${HOUSE_PHOTOGRAPH} fine grain`,
    )
  })
})

describe('buildSetSheetPrompt', () => {
  it('states the grid, each panel’s direction, then the room', () => {
    const prompt = buildSetSheetPrompt({
      name: 'The boardroom',
      layout: 'North wall: windows',
      look: 'A long table',
      styleAnchors: 'fine grain',
    })
    expect(prompt).toContain(
      'A 2x2 contact sheet of four photographs of one room, The boardroom, separated by thin white borders of equal width, each panel 16:9.',
    )
    expect(prompt).toContain('Top left: facing north, the view in reference image 1.')
    expect(prompt).toContain(
      'Top right: facing east. Bottom left: facing south. Bottom right: facing west.',
    )
    expect(prompt).toContain('The room: North wall: windows')
    expect(prompt).not.toContain('A long table')
    expect(prompt.endsWith('fine grain')).toBe(true)
  })

  it('falls back to the look when there is no inventory', () => {
    expect(
      buildSetSheetPrompt({ name: 'R', layout: '', look: 'A long table', styleAnchors: 'a' }),
    ).toContain('The room: A long table')
  })

  it('asks for photographs before the anchors', () => {
    const prompt = buildSetSheetPrompt({ name: 'R', layout: '', look: 'L', styleAnchors: 'a' })
    expect(prompt.endsWith(`${HOUSE_PHOTOGRAPH}\na`)).toBe(true)
  })
})

import { HOUSE_PHOTOGRAPH } from '@boom-busters/providers'
import { describe, expect, it } from 'vitest'
import { buildSetSheetPrompt, describeCamera, setPlateBrief } from './set-plates'

describe('setPlateBrief', () => {
  it('asks for a photograph, then the Brand Kit anchors', () => {
    const brief = setPlateBrief(
      { name: 'R', look: 'A long table', plates: [] },
      'north',
      'fine grain',
    )
    expect(brief.prompt).toBe(
      `R, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level with a 24mm lens. A long table ${HOUSE_PHOTOGRAPH} fine grain`,
    )
  })

  // The house line carries no lens (decision 275), so each plate names its own.
  it('names one lens on every plate that carries no camera', () => {
    const plated = { name: 'R', look: 'L', plates: [{ view: 'north' }] } as unknown as Parameters<
      typeof setPlateBrief
    >[0]
    const first = setPlateBrief({ name: 'R', look: 'L', plates: [] }, 'north', 'a').prompt
    const detail = setPlateBrief(plated, 'detail', 'a').prompt
    expect(first.match(/\d+mm/g)).toEqual(['24mm'])
    expect(detail.match(/\d+mm/g)).toEqual(['50mm'])
    // A compass view's lens is the camera's, stated in the camera sentence.
    expect(setPlateBrief(plated, 'south', 'a').prompt).not.toMatch(/\d+mm/)
  })

  it('shoots a compass view of a plated set from the opposite wall', () => {
    const plated = { name: 'R', look: 'L', plates: [{ view: 'north' }] } as unknown as Parameters<
      typeof setPlateBrief
    >[0]
    expect(setPlateBrief(plated, 'south', 'a').camera).toEqual({
      facing: 'south',
      position: 'the middle of the north wall, at eye level',
      lens: '24mm',
    })
    expect(setPlateBrief(plated, 'detail', 'a').camera).toBeUndefined()
    expect(setPlateBrief({ name: 'R', look: 'L', plates: [] }, 'north', 'a').camera).toBeUndefined()
  })
})

describe('describeCamera', () => {
  const layout = [
    'North wall: three tall windows.',
    'East wall: walnut credenza.',
    'South wall: glass wall onto the corridor.',
    'West wall: bare concrete.',
    'Centre: ten-seat walnut table.',
    'Light: overcast daylight from the north.',
  ].join('\n')

  it('places the camera, then what is in frame, at the edges and behind it', () => {
    expect(
      describeCamera(
        { facing: 'north', position: 'the south doorway, seated eye height', lens: '35mm' },
        layout,
      ),
    ).toBe(
      'The camera stands at the south doorway, seated eye height, facing north, 35mm. ' +
        'In frame: three tall windows. At the edges: walnut credenza; bare concrete. ' +
        'Centre: ten-seat walnut table. Light: overcast daylight from the north. ' +
        'Behind the camera, out of frame: glass wall onto the corridor.',
    )
  })

  it('says only where the camera is when there is no inventory', () => {
    expect(describeCamera({ facing: 'east', position: 'the window' }, '')).toBe(
      'The camera stands at the window, facing east.',
    )
  })

  it('carries an unlabelled inventory whole', () => {
    expect(describeCamera({ facing: 'east', position: 'the window' }, 'A long table.')).toBe(
      'The camera stands at the window, facing east. The room: A long table.',
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
    expect(prompt).toContain(
      'Top left: facing north, the view in reference image 1, looking at the north wall: windows.',
    )
    expect(prompt).toContain('Top right: facing east.')
    expect(prompt).toContain('Bottom left: facing south.')
    expect(prompt).toContain('Bottom right: facing west.')
    expect(prompt).not.toContain('A long table')
    expect(prompt.endsWith('fine grain')).toBe(true)
  })

  // Live run 1 (2026-09-24): with directions alone, the east panel repeated
  // the screen wall. Each panel now names the wall it looks at.
  it('tells each panel which wall it looks at, from the inventory', () => {
    const prompt = buildSetSheetPrompt({
      name: 'R',
      layout: [
        'North wall: a black screen wall.',
        'East wall: shelves and a door.',
        'South wall: white cabinets.',
        'West wall: tall windows.',
        'Centre: a glass table.',
        'Light: overcast daylight.',
      ].join('\n'),
      look: 'L',
      styleAnchors: 'a',
    })
    expect(prompt).toContain(
      'Top right: facing east, looking straight at the east wall: shelves and a door.',
    )
    expect(prompt).toContain(
      'Bottom left: facing south, looking straight at the south wall: white cabinets.',
    )
    expect(prompt).toContain(
      'Bottom right: facing west, looking straight at the west wall: tall windows.',
    )
    // Each wall is said once, in its panel; the room line keeps the rest.
    expect(prompt).toContain('The room: Centre: a glass table. Light: overcast daylight.')
    expect(prompt.match(/tall windows/g)).toHaveLength(1)
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

  it('names one lens and one height, its own', () => {
    const prompt = buildSetSheetPrompt({ name: 'R', layout: '', look: 'L', styleAnchors: 'a' })
    expect(prompt.match(/\d+mm/g)).toEqual(['35mm'])
    expect(prompt.match(/eye level/g)).toHaveLength(1)
  })
})

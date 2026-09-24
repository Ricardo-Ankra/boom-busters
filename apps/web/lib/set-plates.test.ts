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
      `R, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level. A long table ${HOUSE_PHOTOGRAPH} fine grain`,
    )
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

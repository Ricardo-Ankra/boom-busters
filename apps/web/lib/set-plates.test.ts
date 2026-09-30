import { describe, expect, it } from 'vitest'
import { PLATE_PHOTOGRAPH_LINE } from './photograph-lines'
import { buildSetSheetPrompt, describeCamera, framingLead, setPlateBrief } from './set-plates'

describe('setPlateBrief', () => {
  it('draws a plate from the room alone, with no house line or anchors (decision 285)', () => {
    const brief = setPlateBrief({ name: 'Boardroom', look: 'A stark room.', plates: [] }, 'north')
    expect(brief.prompt).toBe(
      'Boardroom, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level with a 24mm lens. A stark room.',
    )
  })

  // The house line carries no lens (decision 275), so each plate names its own.
  it('names one lens on every plate that carries no camera', () => {
    const plated = { name: 'R', look: 'L', plates: [{ view: 'north' }] } as unknown as Parameters<
      typeof setPlateBrief
    >[0]
    const first = setPlateBrief({ name: 'R', look: 'L', plates: [] }, 'north').prompt
    const detail = setPlateBrief(plated, 'detail').prompt
    expect(first.match(/\d+mm/g)).toEqual(['24mm'])
    expect(detail.match(/\d+mm/g)).toEqual(['50mm'])
    // A compass view's lens is the camera's, stated in the camera sentence.
    expect(setPlateBrief(plated, 'south').prompt).not.toMatch(/\d+mm/)
  })

  it('shoots a compass view of a plated set from the opposite wall, at 35mm like the contact sheet (decision 285)', () => {
    const plated = { name: 'R', look: 'L', plates: [{ view: 'north' }] } as unknown as Parameters<
      typeof setPlateBrief
    >[0]
    expect(setPlateBrief(plated, 'south').camera).toEqual({
      facing: 'south',
      position: 'the middle of the north wall, at eye level',
      lens: '35mm',
    })
    expect(setPlateBrief(plated, 'detail').camera).toBeUndefined()
    expect(setPlateBrief({ name: 'R', look: 'L', plates: [] }, 'north').camera).toBeUndefined()
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

  it('places the camera, then what is in frame, on each side, never the wall behind it (decision 285)', () => {
    expect(
      describeCamera(
        { facing: 'north', position: 'the south doorway, seated eye height', lens: '35mm' },
        layout,
      ),
    ).toBe(
      'The camera stands at the south doorway, seated eye height, facing north, 35mm. ' +
        'In frame: three tall windows. Frame left: bare concrete. Frame right: walnut credenza. ' +
        "Centre: ten-seat walnut table. The room's own light: overcast daylight from the north (ahead).",
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

describe('describeCamera (decision 285)', () => {
  const layout =
    'North wall: glass windows.\nEast wall: acoustic panels.\nSouth wall: oak double door.\n' +
    "West wall: frosted glass.\nCentre: the room's only table, ten chairs.\n" +
    'Light: LED panels, daylight from the north.'

  it('names nothing behind the camera on a wide shot (decision 285)', () => {
    const text = describeCamera(
      { facing: 'north', position: 'the south doorway', lens: '24mm' },
      layout,
      'wide',
    )
    expect(text).not.toContain('Behind the camera')
    expect(text).not.toContain('oak double door')
    expect(text).not.toContain('The room:')
    expect(text).toContain("The room's own light: LED panels, daylight from the north (ahead).")
  })

  it('keeps an unlabelled inventory on a wide shot, since it is all there is', () => {
    const text = describeCamera(
      { facing: 'north', position: 'the door' },
      'A long room with one desk.',
      'wide',
    )
    expect(text).toContain('The room: A long room with one desk.')
  })

  it('says ahead, beyond the subject, on a medium shot', () => {
    const text = describeCamera({ facing: 'north', position: 'seated' }, layout, 'medium')
    expect(text).toContain('Ahead, beyond the subject: glass windows.')
    expect(text).not.toMatch(/(^|\. )Behind:/)
  })

  it('shoots a compass view at 35mm, like the contact sheet', () => {
    const brief = setPlateBrief({ name: 'B', look: '', plates: [{} as never] }, 'east')
    expect(brief.camera?.lens).toBe('35mm')
  })
})

describe('describeCamera framing (live run 5)', () => {
  const layout = [
    'North wall: a black screen wall.',
    'East wall: shelves.',
    'South wall: a door.',
    'West wall: windows.',
    'Centre: a glass table.',
    'Light: overcast daylight.',
  ].join('\n')
  const camera = { facing: 'north' as const, position: 'halfway down the table', lens: '85mm' }

  it('gives a close shot only the wall behind the subject, soft, and the light', () => {
    expect(describeCamera(camera, layout, 'close')).toBe(
      'The camera stands at halfway down the table, facing north, 85mm. ' +
        "Behind, soft and out of focus: a black screen wall. The room's own light: overcast daylight.",
    )
  })

  // Live run 6: said at the end, "a close shot" lost to a wide opening.
  it('leads a close or medium prompt with its framing, and a wide one with nothing', () => {
    expect(framingLead(camera, 'close')).toBe(
      'A close shot: the subject fills most of the frame, the background soft and out of focus.',
    )
    expect(framingLead(camera, 'medium')).toBe('A medium shot: the subject from the waist up.')
    expect(framingLead(camera, 'wide')).toBe('')
    expect(framingLead(camera)).toContain('A close shot')
    expect(framingLead(undefined, 'close')).toContain('A close shot')
    expect(framingLead(undefined)).toBe('')
  })

  // Live run 13: naming the window wall pulled it in behind a close subject.
  it('orients a close shot by its light, never by naming the side walls', () => {
    const lit = layout.replace(
      'Light: overcast daylight.',
      'Light: daylight from the west windows.',
    )
    const text = describeCamera(camera, lit, 'close')
    expect(text).toContain(
      "The room's own light: daylight from the west (to the camera's left) windows.",
    )
    expect(text).not.toContain('shelves')
    expect(describeCamera({ ...camera, facing: 'south' }, lit, 'close')).toContain(
      "west (to the camera's right)",
    )
  })

  it('gives a medium shot what is ahead of the subject, its sides and the light, not the whole room (decision 285)', () => {
    const text = describeCamera({ ...camera, lens: '50mm' }, layout, 'medium')
    expect(text).toContain('Ahead, beyond the subject: a black screen wall.')
    expect(text).toContain("To the camera's left: windows. To the camera's right: shelves.")
    expect(text).not.toContain('Centre:')
    expect(text).not.toContain('Behind the camera')
    expect(text).not.toMatch(/(^|\. )Behind:/)
  })

  it('reads a long lens as close when the brief gives no shot size', () => {
    expect(describeCamera(camera, layout)).toContain('Behind, soft and out of focus')
    expect(describeCamera({ ...camera, lens: '35mm' }, layout)).toContain('Frame left:')
  })

  it('keeps left, right and centre for a wide shot, but never what is behind the camera (decision 285)', () => {
    const text = describeCamera({ ...camera, lens: '85mm' }, layout, 'wide')
    expect(text).toContain('Frame left: windows. Frame right: shelves.')
    expect(text).not.toContain('Behind the camera')
    expect(text).not.toContain('a door')
  })
})

describe('buildSetSheetPrompt', () => {
  it('states the grid, each panel’s direction, then the room', () => {
    const prompt = buildSetSheetPrompt({
      name: 'The boardroom',
      layout: 'North wall: windows',
      look: 'A long table',
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
    expect(prompt.endsWith(PLATE_PHOTOGRAPH_LINE)).toBe(true)
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
    expect(buildSetSheetPrompt({ name: 'R', layout: '', look: 'A long table' })).toContain(
      'The room: A long table',
    )
  })

  it('ends the sheet with the plate photograph line and no anchors', () => {
    const prompt = buildSetSheetPrompt({
      name: 'Boardroom',
      layout: 'North wall: glass.',
      look: '',
    })
    expect(prompt.endsWith(PLATE_PHOTOGRAPH_LINE)).toBe(true)
    expect(prompt).not.toMatch(/film grain|candid/)
  })

  it('names one lens and one height, its own', () => {
    const prompt = buildSetSheetPrompt({ name: 'R', layout: '', look: 'L' })
    expect(prompt.match(/\d+mm/g)).toEqual(['35mm'])
    expect(prompt.match(/eye level/g)).toHaveLength(1)
  })
})

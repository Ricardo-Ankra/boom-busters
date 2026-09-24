import { describe, expect, it } from 'vitest'
import {
  MAX_SET_PLATES,
  ProjectSetSchema,
  SetPlateSchema,
  layoutView,
  parseLayout,
  platesForCamera,
  referencePlates,
  setForBrief,
  uploadedPlateView,
} from './sets'
import type { SetPlate } from './sets'

function plate(view: SetPlate['view'], hash = `h-${view}`): SetPlate {
  return {
    r2Key: `boom-busters/sets/p1/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 900,
    view,
    origin: 'uploaded',
  }
}

const set = {
  id: 's1',
  projectId: 'p1',
  name: 'Venture Capital Boardroom',
  look: 'A high-end austere meeting room with a long polished table.',
  plates: [plate('detail'), plate('north')],
}

describe('set schemas', () => {
  it('parses a set with plates', () => {
    expect(ProjectSetSchema.parse(set).plates).toHaveLength(2)
  })

  it('caps the plates at six', () => {
    const seven = { ...set, plates: [1, 2, 3, 4, 5, 6, 7].map((n) => plate('other', `h${n}`)) }
    expect(ProjectSetSchema.safeParse(seven).success).toBe(false)
    expect(MAX_SET_PLATES).toBe(6)
  })

  it('refuses a plate type the image models do not take', () => {
    expect(SetPlateSchema.safeParse({ ...plate('other'), mimeType: 'image/gif' }).success).toBe(
      false,
    )
  })

  it('needs a name: it is the join key a brief uses', () => {
    expect(ProjectSetSchema.safeParse({ ...set, name: '  ' }).success).toBe(false)
  })

  it('remembers whether a plate was uploaded or generated', () => {
    expect(SetPlateSchema.parse({ ...plate('other'), origin: 'generated' }).origin).toBe(
      'generated',
    )
    expect(SetPlateSchema.safeParse({ ...plate('other'), origin: 'borrowed' }).success).toBe(false)
  })
})

describe('plate views', () => {
  it('reads the decision 273/274 names as compass directions', () => {
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'establishing' }).view).toBe('north')
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'reverse' }).view).toBe('south')
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'side' }).view).toBe('east')
    expect(SetPlateSchema.safeParse({ ...plate('north'), view: 'sideways' }).success).toBe(false)
  })

  it('holds six plates: four directions and two details', () => {
    expect(MAX_SET_PLATES).toBe(6)
    const seven = { ...set, plates: [1, 2, 3, 4, 5, 6, 7].map((n) => plate('other', `h${n}`)) }
    expect(ProjectSetSchema.safeParse(seven).success).toBe(false)
  })
})

describe('referencePlates', () => {
  it('sends north first and honours the limit', () => {
    expect(referencePlates(set, 2).map((p) => p.view)).toEqual(['north', 'detail'])
    expect(referencePlates(set, 1).map((p) => p.view)).toEqual(['north'])
    expect(referencePlates(set, 0)).toEqual([])
  })

  it('prefers a second direction over a detail, whatever the upload order', () => {
    const plates = [plate('north'), plate('detail'), plate('south')]
    expect(referencePlates({ plates }, 2).map((p) => p.view)).toEqual(['north', 'south'])
  })
})

describe('platesForCamera', () => {
  const full = [plate('north'), plate('east'), plate('south'), plate('west'), plate('detail')]

  it('sends the facing plate, then an adjacent one, never the opposite', () => {
    expect(platesForCamera({ plates: full }, 'north', 2).map((p) => p.view)).toEqual([
      'north',
      'east',
    ])
    expect(platesForCamera({ plates: full }, 'south', 2).map((p) => p.view)).toEqual([
      'south',
      'west',
    ])
    expect(platesForCamera({ plates: full }, 'east', 3).map((p) => p.view)).toEqual([
      'east',
      'south',
      'north',
    ])
  })

  it('uses an adjacent plate when the facing one is missing', () => {
    const plates = [plate('north'), plate('west')]
    expect(platesForCamera({ plates }, 'south', 2).map((p) => p.view)).toEqual(['west'])
  })

  it('sends the only plate a set has, even facing away from it', () => {
    expect(platesForCamera({ plates: [plate('north')] }, 'south', 2).map((p) => p.view)).toEqual([
      'north',
    ])
  })

  // Review Focus 1: uploads from before this decision are `other`.
  it('sends plates whose direction nobody stated', () => {
    const plates = [plate('other', 'o1'), plate('other', 'o2')]
    expect(platesForCamera({ plates }, 'east', 2).map((p) => p.contentHash)).toEqual(['o1', 'o2'])
  })

  it('falls back to referencePlates with no camera', () => {
    expect(platesForCamera({ plates: full }, undefined, 2).map((p) => p.view)).toEqual([
      'north',
      'south',
    ])
  })
})

describe('uploadedPlateView', () => {
  it("records a set's first upload as north and later ones as other", () => {
    expect(uploadedPlateView({ plates: [] })).toBe('north')
    expect(uploadedPlateView({ plates: [plate('north')] })).toBe('other')
  })
})

describe('setForBrief', () => {
  const boardroom = { name: 'Venture Capital Boardroom' }
  const office = { name: 'Stability AI London Headquarters' }

  it('matches the exact name and a name carrying a description', () => {
    expect(setForBrief('Venture Capital Boardroom', [office, boardroom])).toBe(boardroom)
    expect(setForBrief('Venture Capital Boardroom, at dusk', [office, boardroom])).toBe(boardroom)
  })

  it('returns null for no set, an unknown set, or a name merely mentioned', () => {
    expect(setForBrief(undefined, [boardroom])).toBeNull()
    expect(setForBrief('   ', [boardroom])).toBeNull()
    expect(setForBrief('A car park', [boardroom])).toBeNull()
    expect(setForBrief('outside the Venture Capital Boardroom', [boardroom])).toBeNull()
  })
})

describe('parseLayout', () => {
  const text = [
    'North wall: three tall windows, overcast city view.',
    'east: walnut credenza, door at the south end',
    'South Wall: glass wall onto the corridor.',
    'West wall: bare concrete, a dark screen.',
    'Center: ten-seat walnut table, black mesh chairs.',
    'Light: overcast daylight from the north windows.',
  ].join('\n')

  it('reads each labelled line, whatever its case, and drops the full stop', () => {
    expect(parseLayout(text)).toEqual({
      north: 'three tall windows, overcast city view',
      east: 'walnut credenza, door at the south end',
      south: 'glass wall onto the corridor',
      west: 'bare concrete, a dark screen',
      centre: 'ten-seat walnut table, black mesh chairs',
      light: 'overcast daylight from the north windows',
      rest: '',
    })
  })

  // Review Focus 2: an owner may write prose with no labels.
  it('keeps unlabelled text whole as the rest', () => {
    expect(parseLayout('A long table.\nWindows behind it.')).toEqual({
      rest: 'A long table. Windows behind it.',
    })
  })
})

describe('layoutView', () => {
  it('puts the facing wall in frame, its neighbours at the edges and the opposite behind', () => {
    const view = layoutView(
      parseLayout(
        'North wall: windows\nEast wall: credenza\nSouth wall: glass\nWest wall: concrete',
      ),
      'south',
    )
    // Facing south, the adjacent walls are west then east.
    expect(view).toEqual({
      inFrame: 'glass',
      edges: ['concrete', 'credenza'],
      behind: 'windows',
      rest: '',
    })
  })
})

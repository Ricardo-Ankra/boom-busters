import { describe, expect, it } from 'vitest'
import {
  MAX_SET_PLATES,
  ProjectSetSchema,
  SetPlateSchema,
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
  plates: [plate('detail'), plate('establishing')],
}

describe('set schemas', () => {
  it('parses a set with plates', () => {
    expect(ProjectSetSchema.parse(set).plates).toHaveLength(2)
  })

  it('caps the plates at four', () => {
    const many = { ...set, plates: [1, 2, 3, 4, 5].map((n) => plate('other', `h${n}`)) }
    expect(ProjectSetSchema.safeParse(many).success).toBe(false)
    expect(MAX_SET_PLATES).toBe(4)
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

describe('referencePlates', () => {
  it('sends the establishing view first and honours the limit', () => {
    expect(referencePlates(set, 2).map((p) => p.view)).toEqual(['establishing', 'detail'])
    expect(referencePlates(set, 1).map((p) => p.view)).toEqual(['establishing'])
    expect(referencePlates(set, 0)).toEqual([])
  })

  // Decision 274: only two travel, so they should be two viewpoints.
  it('prefers a second angle over a detail, whatever the upload order', () => {
    const plates = [plate('establishing'), plate('detail'), plate('reverse')]
    expect(referencePlates({ plates }, 2).map((p) => p.view)).toEqual(['establishing', 'reverse'])
  })

  it('sends a different view before a second copy of one already sent', () => {
    const plates = [plate('establishing', 'e1'), plate('establishing', 'e2'), plate('side', 's1')]
    expect(referencePlates({ plates }, 2).map((p) => p.contentHash)).toEqual(['e1', 's1'])
    expect(referencePlates({ plates }, 3).map((p) => p.contentHash)).toEqual(['e1', 's1', 'e2'])
  })

  it('keeps upload order among plates whose view nobody stated', () => {
    const plates = [plate('other', 'o1'), plate('other', 'o2')]
    expect(referencePlates({ plates }, 2).map((p) => p.contentHash)).toEqual(['o1', 'o2'])
  })
})

describe('uploadedPlateView', () => {
  it("records a set's first upload as the establishing view and later ones as other", () => {
    expect(uploadedPlateView({ plates: [] })).toBe('establishing')
    expect(uploadedPlateView({ plates: [plate('establishing')] })).toBe('other')
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

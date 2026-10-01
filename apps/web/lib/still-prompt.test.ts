import { describe, expect, it } from 'vitest'
import type { CastMember, ProjectSet } from '@boom-busters/schemas'
import { PHOTOGRAPH_LINE, PLATE_PHOTOGRAPH_LINE, TEASER_COMPOSITION } from './photograph-lines'
import { framingLead } from './set-plates'
import {
  assembleStillPrompt,
  planStillReferences,
  REFERENCE_MARKER,
  referenceSentences,
  sceneOf,
} from './still-prompt'

const photo = (key: string) => ({
  r2Key: key,
  contentHash: key,
  mimeType: 'image/jpeg' as const,
  width: 800,
  height: 800,
  view: 'front' as const,
})
const plate = (view: 'north' | 'east' | 'south' | 'west') => ({
  r2Key: `plate/${view}`,
  contentHash: view,
  mimeType: 'image/png' as const,
  width: 1600,
  height: 900,
  view,
  origin: 'generated' as const,
})
const emad = { name: 'Emad Mostaque', photos: [photo('a'), photo('b')] } as unknown as CastMember
const boardroom = {
  name: 'The Stability AI Boardroom',
  look: 'A stark conference room.',
  layout:
    'North wall: glass windows.\nEast wall: acoustic panels.\nSouth wall: oak double door.\n' +
    'West wall: frosted glass.\nCentre: one long dark table, ten mesh chairs.\nLight: LED panels.',
  plates: [plate('north'), plate('east'), plate('south')],
} as unknown as ProjectSet

describe('planStillReferences', () => {
  it('spends people first and counts what travels', () => {
    const plan = planStillReferences([emad], boardroom, { characters: 3, objects: 2 }, 'south')
    expect(plan.people).toEqual([{ name: 'Emad Mostaque', photos: 2 }])
    expect(plan.setName).toBe('The Stability AI Boardroom')
    expect(plan.plates.map((p) => p.view)[0]).toBe('south')
    expect(plan.plates).toHaveLength(2)
  })

  it('names no set when no plate travels', () => {
    const plan = planStillReferences([], boardroom, { characters: 3, objects: 0 })
    expect(plan.setName).toBeNull()
    expect(plan.plates).toEqual([])
  })
})

const LEGACY_HOUSE =
  'An available-light documentary photograph, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line; people caught candid and mid-moment, never posing or acting for the camera.'
const LEGACY_ANCHORS =
  'subtle film grain; muted documentary colour grade anchored on #0f1115 and #ef4444 against #0a0a0b; sombre, photographic realism'

describe('sceneOf (decision 287)', () => {
  it('strips the house line and anchors the planner pasted', () => {
    expect(sceneOf(`Emad at the table, hands clasped. ${LEGACY_HOUSE} ${LEGACY_ANCHORS}`)).toBe(
      'Emad at the table, hands clasped.',
    )
  })

  it('strips the palette prefix and keeps the planner words after the anchors', () => {
    expect(
      sceneOf(
        `A laptop on a desk. ${LEGACY_HOUSE} accent #ef4444, cold; ${LEGACY_ANCHORS}. Eye level, 35mm lens.`,
      ),
    ).toBe('A laptop on a desk. Eye level, 35mm lens.')
  })

  it('strips the older house line that still named a lens', () => {
    const older =
      'An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.'
    expect(sceneOf(`A door. ${older}`)).toBe('A door.')
  })

  // Reviewer's probe: an unbounded gap let the house-line match start at
  // prose the planner wrote and run across full stops to the pasted line's
  // tail, losing the whole scene. Neither house-line variant has a full
  // stop before "real materials with wear", so the gap is bounded to one
  // sentence instead.
  it('stops the house-line gap at one sentence, so planner prose before it survives', () => {
    expect(
      sceneOf(
        `An available-light documentary photograph, dusk. Emad at the table, hands clasped. ${LEGACY_HOUSE}`,
      ),
    ).toBe('An available-light documentary photograph, dusk. Emad at the table, hands clasped.')
  })

  // A named accent reads exactly like prose that mentions an accent wall or
  // an accent colour, so it only strips in the shape it was actually pasted
  // in: immediately before the legacy anchors clause.
  it('strips a named, non-hex accent only when the anchors clause follows it', () => {
    const anchors =
      'subtle film grain; muted documentary colour grade anchored on #111 and #222 against #333; sombre, photographic realism'
    expect(sceneOf(`A desk. accent muted gold, cold; ${anchors} more.`)).toBe('A desk. more.')
  })

  // Re-reviewer's probes: prose that merely mentions an accent must survive,
  // because it never leads into the legacy anchors clause.
  it('leaves plain prose that merely mentions an accent alone', () => {
    const wall = "The room's accent wall is bold, cold; a draught crept under the door."
    const colour = 'He picked an accent colour, warm; she disagreed.'
    expect(sceneOf(wall)).toBe(wall)
    expect(sceneOf(colour)).toBe(colour)
  })

  it('leaves an ellipsis and an abbreviation’s punctuation alone', () => {
    expect(sceneOf('He waits... then signs.')).toBe('He waits... then signs.')
    expect(sceneOf('e.g., a ledger')).toBe('e.g., a ledger')
  })

  it('strips a clean-grain anchors line and the old teaser clause', () => {
    const anchors =
      'clean, no grain; muted documentary colour grade anchored on #111 and #222 against #333; sombre, photographic realism'
    const teaser =
      'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, nothing important in the bottom quarter where captions sit.'
    expect(sceneOf(`A podium. ${teaser} ${anchors}`)).toBe('A podium.')
  })

  it('cuts an old reference declaration an owner pasted back in', () => {
    expect(sceneOf(`Emad at a podium.\n\n${REFERENCE_MARKER} 2 photographs of Emad.`)).toBe(
      'Emad at a podium.',
    )
  })

  it('leaves a clean scene as it is, and is idempotent', () => {
    const clean = 'Four directors at a long table, dusk light from the windows.'
    expect(sceneOf(clean)).toBe(clean)
    const once = sceneOf(`A desk. ${LEGACY_HOUSE}`)
    expect(sceneOf(once)).toBe(once)
  })
})

describe('assembleStillPrompt (decision 287)', () => {
  const camera = { facing: 'south' as const, position: 'the north windows, seated', lens: '35mm' }
  const base = {
    scene: `Emad Mostaque seated at the long table, hands clasped. ${LEGACY_HOUSE} ${LEGACY_ANCHORS}`,
    shotSize: 'medium' as const,
    camera,
    layout: boardroom.layout,
    people: [{ name: 'Emad Mostaque', photos: 2 }],
    set: { name: 'The Stability AI Boardroom', plates: 2 },
  }

  it('puts framing, camera, scene, references and the photograph line in that order', () => {
    const prompt = assembleStillPrompt(base)
    const at = (text: string) => prompt.indexOf(text)
    expect(at('A medium shot')).toBe(0)
    expect(at('The camera stands at')).toBeGreaterThan(at('A medium shot'))
    expect(at('Emad Mostaque seated')).toBeGreaterThan(at('The camera stands at'))
    expect(at(REFERENCE_MARKER)).toBeGreaterThan(at('Emad Mostaque seated'))
    expect(prompt.endsWith(PHOTOGRAPH_LINE)).toBe(true)
  })

  it('names one lens, one camera, and no grain, hex code or listed prop', () => {
    const prompt = assembleStillPrompt(base)
    expect(prompt.match(/\d+\s?mm/g)).toEqual(['35mm'])
    expect(prompt.match(/The camera stands at/g)).toHaveLength(1)
    expect(prompt).not.toMatch(/grain|#[0-9a-f]{3,8}|coffee|cable runs/i)
  })

  it('frames a still with no camera from its shot size', () => {
    const prompt = assembleStillPrompt({
      scene: 'An invoice on a desk.',
      shotSize: 'close',
      layout: '',
      people: [],
      set: null,
    })
    expect(prompt.startsWith('A close shot:')).toBe(true)
  })

  it('gives a wide or unsized still no framing lead', () => {
    const prompt = assembleStillPrompt({
      scene: 'A data centre aisle.',
      layout: '',
      people: [],
      set: null,
    })
    expect(prompt.startsWith('A data centre aisle.')).toBe(true)
  })

  it('sends the camera for a set with an inventory but no plates, and promises no photographs', () => {
    const prompt = assembleStillPrompt({ ...base, people: [], set: null })
    expect(prompt).toContain('The camera stands at')
    expect(prompt).not.toContain(REFERENCE_MARKER)
  })

  it('says a set photograph is new without the edit wording, with or without a camera', () => {
    const withCamera = assembleStillPrompt(base)
    const without = assembleStillPrompt({ ...base, camera: undefined })
    for (const prompt of [withCamera, without]) {
      expect(prompt).toContain("show this room's furniture, materials and light")
      expect(prompt).not.toContain('never reproduce or edit the framing')
    }
  })

  it('builds a plate with no framing lead, no people clause and the plate line', () => {
    const prompt = assembleStillPrompt({
      scene:
        'The Stability AI Boardroom, empty of people: a wide photograph of the whole room facing east. A stark room.',
      camera: {
        facing: 'east',
        position: 'the middle of the west wall, at eye level',
        lens: '35mm',
      },
      layout: boardroom.layout,
      people: [],
      set: { name: 'The Stability AI Boardroom', plates: 1 },
      kind: 'plate',
    })
    expect(prompt.startsWith('The camera stands at')).toBe(true)
    expect(prompt.endsWith(PLATE_PHOTOGRAPH_LINE)).toBe(true)
    expect(prompt).not.toContain('candid')
  })

  it('adds the teaser composition to a teaser', () => {
    const prompt = assembleStillPrompt({
      scene: 'Emad at a podium.',
      layout: '',
      people: [],
      set: null,
      kind: 'teaser',
    })
    expect(prompt).toContain(TEASER_COMPOSITION)
    expect(prompt).not.toContain('9:16')
  })

  // The rule this guards: no named prop, no lens, no grain, anywhere the
  // assembler writes for itself rather than quoting the planner. Extended
  // (final review) to the framing lead with no camera and the reference
  // sentences, which say "photographed" but must name no prop either.
  it('keeps every fixed line, framing lead and reference sentence free of named props', () => {
    const forbidden = /coffee|cup|mug|cable|paper|laptop|monitor|dust|rain|grain|\d+\s?mm/i
    const lines = [
      PHOTOGRAPH_LINE,
      PLATE_PHOTOGRAPH_LINE,
      TEASER_COMPOSITION,
      framingLead(undefined, 'close'),
      framingLead(undefined, 'medium'),
      ...referenceSentences([{ name: 'X', photos: 1 }], { name: 'Room', plates: 1 }, true),
      ...referenceSentences([{ name: 'X', photos: 1 }], { name: 'Room', plates: 1 }, false),
    ]
    for (const line of lines) expect(line).not.toMatch(forbidden)
  })
})

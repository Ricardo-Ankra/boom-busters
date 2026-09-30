import { describe, expect, it } from 'vitest'
import type { CastMember, ProjectSet } from '@boom-busters/schemas'
import { describeCamera, framingLead } from './set-plates'
import { assembleStillPrompt, planStillReferences, withReferenceClause } from './still-prompt'

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

describe('assembleStillPrompt (decision 285, Task 1: today behaviour)', () => {
  it('matches the pre-refactor composition exactly', () => {
    const camera = { facing: 'south' as const, position: 'the north windows, seated', lens: '35mm' }
    const scene = 'Emad Mostaque seated at the long table, hands clasped.'
    const expected = withReferenceClause(
      `${framingLead(camera, 'medium')}${scene}`,
      [{ name: 'Emad Mostaque', photos: 2 }],
      { name: 'The Stability AI Boardroom', plates: 2 },
      describeCamera(camera, boardroom.layout, 'medium'),
    )
    expect(
      assembleStillPrompt({
        scene,
        shotSize: 'medium',
        camera,
        layout: boardroom.layout,
        people: [{ name: 'Emad Mostaque', photos: 2 }],
        set: { name: 'The Stability AI Boardroom', plates: 2 },
      }),
    ).toBe(expected)
  })

  it('strips banned words from the scene, as generation always has', () => {
    expect(
      assembleStillPrompt({
        scene: 'A cinematic boardroom at dusk.',
        layout: '',
        people: [],
        set: null,
      }),
    ).toBe('A boardroom at dusk.')
  })
})

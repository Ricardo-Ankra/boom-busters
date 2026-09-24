import { describe, expect, it } from 'vitest'
import { layoutDraftRequest } from './set-layout-prompt'

const image = { mimeType: 'image/png' as const, data: 'AAAA' }

describe('layoutDraftRequest', () => {
  const content = layoutDraftRequest({ name: 'The boardroom', look: 'A long table', image })
    .messages[0]!.content

  // Live run 1 (2026-09-24): "north is the wall this photograph faces" let the
  // drafter call the prominent window wall north in a diagonal shot, so the
  // inventory and the sheet disagreed about the compass.
  it('fixes the compass to the frame: far wall north, left west, right east, behind south', () => {
    expect(content).toContain(
      'North is the far wall straight ahead of the camera, where its line of sight ends at the centre of the frame.',
    )
    expect(content).toContain('West is the wall along the left side of the frame')
    expect(content).toContain('east is the wall along the right side')
    expect(content).toContain('south is the wall behind the camera')
  })

  it('describes each wall once, never as a copy of another', () => {
    expect(content).toContain('Describe each wall as its own surface; never as matching another wall.')
  })

  it('still asks for the six labelled lines and the look', () => {
    expect(content).toContain('"North wall:", "East wall:", "South wall:", "West wall:", "Centre:", "Light:"')
    expect(content).toContain("The room's look: A long table.")
  })
})

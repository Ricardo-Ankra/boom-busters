import { HOUSE_PHOTOGRAPH } from '@boom-busters/providers'
import { describe, expect, it } from 'vitest'
import { withCameraLens } from './still-prompt'

describe('withCameraLens', () => {
  it('is a guard: the house photograph line still names 35mm as its default', () => {
    // If this ever stops being true, the swap below has nothing to swap.
    expect(HOUSE_PHOTOGRAPH).toContain('35mm')
  })

  it("swaps the house photograph line's 35mm for the camera's own lens", () => {
    const prompt = `A boardroom at dusk. ${HOUSE_PHOTOGRAPH}`
    expect(withCameraLens(prompt, '85mm')).toBe(
      `A boardroom at dusk. ${HOUSE_PHOTOGRAPH.replace('35mm', '85mm')}`,
    )
    expect(withCameraLens(prompt, '85mm')).not.toContain('35mm')
  })

  it('leaves the prompt unchanged when the camera names no lens', () => {
    const prompt = `A boardroom at dusk. ${HOUSE_PHOTOGRAPH}`
    expect(withCameraLens(prompt, undefined)).toBe(prompt)
  })

  it('leaves a prompt with no house photograph line unchanged', () => {
    const prompt = 'A boardroom at dusk, no house line here.'
    expect(withCameraLens(prompt, '85mm')).toBe(prompt)
  })
})

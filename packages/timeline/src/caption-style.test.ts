import { describe, expect, it } from 'vitest'
import { assemblyCaptionStyle, captionsBurnedIn, withCaptions } from './caption-style'
import { compileTimeline } from './compile'
import { goldenInput } from './compile.test'

describe('withCaptions', () => {
  it('turns captions off and keeps the words, so turning them on again is a flip', () => {
    const original = compileTimeline(goldenInput())
    expect(captionsBurnedIn(original)).toBe(true)

    const off = withCaptions(original, false)
    expect(off.captions.style).toBe('none')
    expect(captionsBurnedIn(off)).toBe(false)
    expect(off.captions.words).toEqual(original.captions.words)

    const on = withCaptions(off, true)
    expect(on).toEqual(original)
  })

  it('assembles with captions off first, then keeps the owner’s last choice', () => {
    const original = compileTimeline(goldenInput())
    expect(assemblyCaptionStyle(undefined)).toBe('none')
    expect(assemblyCaptionStyle(original)).toBe('karaoke')
    expect(assemblyCaptionStyle(withCaptions(original, false))).toBe('none')
    expect(assemblyCaptionStyle({ not: 'a timeline' })).toBe('none')
  })

  it('touches nothing but the caption style', () => {
    const original = compileTimeline(goldenInput())
    const off = withCaptions(original, false)
    expect({ ...off, captions: original.captions }).toEqual(original)
  })
})

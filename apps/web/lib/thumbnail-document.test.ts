import { describe, expect, it } from 'vitest'
import type { TextBox } from './graphic-code/frames'
import {
  SCRIM_ALPHA,
  headlineFontPx,
  scrimContrast,
  thumbnailDocument,
  thumbnailWarnings,
} from './thumbnail-document'

const BRAND = {
  colors: {
    background: '#101418',
    textPrimary: '#f4f1ea',
  },
  fonts: { heading: 'Anton', body: 'Inter' },
} as unknown as Parameters<typeof thumbnailDocument>[0]['brand']

function document(over: Partial<Parameters<typeof thumbnailDocument>[0]> = {}): string {
  return thumbnailDocument({
    pictureSrc: 'data:image/png;base64,AAAA',
    headline: 'The crash nobody saw',
    textSide: 'left',
    brand: BRAND,
    mark: { wordmark: 'Boom & Busters' },
    markPlacement: 'tl',
    ...over,
  })
}

function box(over: Partial<TextBox> = {}): TextBox {
  return {
    node: 1,
    text: 'THE CRASH',
    x: 60,
    y: 100,
    width: 700,
    height: 200,
    fontPx: 200,
    opacity: 1,
    moving: false,
    color: 'rgb(244, 241, 234)',
    ground: null,
    ...over,
  }
}

const OK = { headline: 'The crash', fontPx: 200, boxes: [box()], contrast: 9 }

describe('thumbnailDocument', () => {
  it('composes without a headline', () => {
    const html = document({ headline: '' })
    expect(html).toContain('id="frame"')
    expect(html).not.toContain('data-role="scrim"')
    expect(html).not.toContain('data-role="headline"')
    expect(thumbnailWarnings({ headline: '', fontPx: 220, boxes: [], contrast: null })).toEqual([])
  })

  it('puts the scrim and the headline on the asked side', () => {
    const left = document({ textSide: 'left' })
    expect(left).toMatch(/data-role="scrim"[^>]*linear-gradient\(to right/)
    expect(left).toMatch(/data-role="headline"[^>]*left:3%/)
    const right = document({ textSide: 'right' })
    expect(right).toMatch(/data-role="scrim"[^>]*linear-gradient\(to left/)
    expect(right).toMatch(/data-role="headline"[^>]*right:3%/)
  })

  it('keeps the headline in the outer 44% and above 84% of the height', () => {
    const html = document()
    expect(html).toMatch(/data-role="headline"[^>]*width:41%/)
    expect(html).toMatch(/data-role="headline"[^>]*bottom:16%/)
    expect(html).toContain('text-transform:uppercase')
    expect(html).toContain('font-size:160px')
    expect(html).toContain("font-family:'Anton'")
  })

  it('escapes the headline', () => {
    const html = document({ headline: '<b>big</b>' })
    expect(html).toContain('&lt;b&gt;big&lt;/b&gt;')
    expect(html).not.toContain('<b>big</b>')
  })

  it('uses the real mark when there is one and the wordmark when there is not', () => {
    const real = document({ mark: { src: 'https://cdn.example/logo.png' } })
    expect(real).toContain('src="https://cdn.example/logo.png"')
    expect(real).toContain('height:86px')
    expect(real).toContain('opacity:0.8')
    expect(real).not.toContain('Boom &amp; Busters')
    const word = document({ mark: { wordmark: 'Boom & Busters' } })
    expect(word).toContain('Boom &amp; Busters')
    expect(word).toContain('letter-spacing:0.08em')
  })

  it('leaves the mark out at none', () => {
    const html = document({ markPlacement: 'none', mark: { src: 'https://cdn.example/logo.png' } })
    expect(html).not.toContain('data-role="mark"')
    expect(html).not.toContain('logo.png')
    expect(document({ mark: null })).not.toContain('data-role="mark"')
  })

  it('never places the mark bottom right', () => {
    for (const markPlacement of ['tl', 'tr', 'bl'] as const) {
      const html = document({ markPlacement })
      const mark = /data-role="mark"[^>]*style="([^"]*)"/.exec(html)![1]!
      expect(mark.includes('right:') && mark.includes('bottom:')).toBe(false)
      expect(mark).toContain(markPlacement.startsWith('t') ? 'top:' : 'bottom:')
      expect(mark).toContain(markPlacement.endsWith('l') ? 'left:' : 'right:')
    }
  })
})

describe('headlineFontPx', () => {
  it('sizes type between the ceiling and the floor', () => {
    expect(headlineFontPx('12345678')).toBe(220)
    expect(headlineFontPx('1234')).toBe(220)
    expect(headlineFontPx('1'.repeat(28))).toBe(120)
    expect(headlineFontPx('1'.repeat(60))).toBe(120)
    expect(headlineFontPx('1'.repeat(18))).toBe(170)
  })
})

describe('scrimContrast', () => {
  it('measures contrast against the worse of light and dark', () => {
    // Mid-grey type on a mid-grey scrim: the scrim over black is dark, over
    // white it is light; the grey sits near both, so the worse side is low.
    const mid = scrimContrast('#808080', '#808080', SCRIM_ALPHA)
    expect(mid).not.toBeNull()
    expect(mid!).toBeLessThan(4.5)
    expect(thumbnailWarnings({ ...OK, contrast: mid })).toContain(
      'The headline does not stand out enough from what is behind it.',
    )
    // Off-white type on a near-black scrim reads over both.
    expect(scrimContrast('#f4f1ea', '#101418')!).toBeGreaterThan(4.5)
  })

  it('is null for a colour it cannot read', () => {
    expect(scrimContrast('red', '#101418')).toBeNull()
  })
})

describe('thumbnailWarnings', () => {
  it('is quiet for a good headline', () => {
    expect(thumbnailWarnings(OK)).toEqual([])
  })

  it('warns on five words', () => {
    expect(thumbnailWarnings({ ...OK, headline: 'one two three four five' })).toEqual([
      'The headline is 5 words; four is the ceiling.',
    ])
  })

  it('warns under the size floor', () => {
    expect(thumbnailWarnings({ ...OK, fontPx: 119 })).toEqual([
      "The headline's type is under the size floor.",
    ])
  })

  it('warns when a word cannot fit at the floor', () => {
    const wide = box({ x: 40, width: 2100 })
    expect(thumbnailWarnings({ ...OK, boxes: [wide] })).toEqual([
      'The headline runs outside the frame.',
    ])
    expect(thumbnailWarnings({ ...OK, boxes: [box({ y: 900, height: 200 })] })).toContain(
      'The headline runs outside the frame.',
    )
  })

  it('warns when a box enters the keep-out', () => {
    const inside = box({ x: 1500, y: 910, width: 100, height: 60 })
    expect(thumbnailWarnings({ ...OK, boxes: [inside] })).toEqual([
      'The headline sits where YouTube draws the duration.',
    ])
    // Right of the line but above it is clear; so is below the line but left of it.
    expect(
      thumbnailWarnings({ ...OK, boxes: [box({ x: 1500, y: 100, width: 100, height: 200 })] }),
    ).toEqual([])
    expect(thumbnailWarnings({ ...OK, boxes: [box({ x: 60, y: 900, height: 100 })] })).toEqual([])
  })
})

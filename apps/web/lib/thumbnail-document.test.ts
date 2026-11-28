import { describe, expect, it } from 'vitest'
import type { TextBox } from './graphic-code/frames'
import {
  SCRIM_ALPHA,
  headlineBoxes,
  headlineFontPx,
  headlineTextNodes,
  headlineWeight,
  highlightInk,
  scrimContrast,
  thumbnailDocument,
  thumbnailWarnings,
} from './thumbnail-document'

const BRAND = {
  colors: {
    background: '#101418',
    textPrimary: '#f4f1ea',
    accent: '#f5a524',
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
    highlight: '',
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

describe('headline weight', () => {
  const fonts = (heading: string) => ({ ...BRAND.fonts, heading })

  it("uses the face's own heaviest weight", () => {
    const catalogue = [{ family: 'Two Weights', weights: [400, 600] }]
    expect(headlineWeight('Two Weights', catalogue)).toBe(600)
    expect(headlineWeight('Inter')).toBe(800)
    expect(headlineWeight('JetBrains Mono')).toBe(700)
    expect(headlineWeight('Heavy', [{ family: 'Heavy', weights: [400, 900] }])).toBe(800)
    expect(document({ brand: { ...BRAND, fonts: fonts('JetBrains Mono') } })).toContain(
      'font-weight:700',
    )
    expect(document({ brand: { ...BRAND, fonts: fonts('Inter') } })).toContain('font-weight:800')
  })

  it('a single-weight face is not asked for bold', () => {
    const catalogue = [{ family: 'Display', weights: [400] }]
    expect(headlineWeight('Display', catalogue)).toBe(400)
  })

  it('asks for 700 when the face is not in the catalogue', () => {
    expect(headlineWeight('Anton')).toBe(700)
    expect(document()).toContain('font-weight:700')
  })
})

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

describe('headlineBoxes', () => {
  it("picks the headline's boxes when a wordmark follows", () => {
    const lineOne = box({ node: 4, text: 'THE CRASH' })
    const lineTwo = box({ node: 4, text: 'NOBODY SAW', y: 300 })
    const wordmark = box({ node: 7, text: 'BOOM & BUSTERS', x: 77, y: 43, fontPx: 43 })
    expect(headlineBoxes([lineOne, lineTwo, wordmark])).toEqual([lineOne, lineTwo])
  })

  it('returns none when there is no text', () => {
    expect(headlineBoxes([])).toEqual([])
  })
})

const BLOCK =
  'style="display:inline-block;background:#f5a524;color:#101418;padding:0 0.14em;margin:0 -0.14em"'

function brandWith(accent: string) {
  return {
    ...BRAND,
    colors: { ...BRAND.colors, accent },
  } as Parameters<typeof thumbnailDocument>[0]['brand']
}

describe('the highlight on the page', () => {
  it('no highlight leaves the page as it was', () => {
    const html = document({ highlight: '' })
    expect(html).toContain('<span>The crash nobody saw</span>')
    expect(html).not.toContain('data-role="highlight"')
  })

  it('sets each highlighted word on an accent block', () => {
    const html = document({ headline: 'They lost $2 billion', highlight: '2 billion' })
    expect(html).toContain(
      `<span>They lost <span data-role="highlight" ${BLOCK}>$2</span> <span data-role="highlight" ${BLOCK}>billion</span></span>`,
    )
  })

  it('keeps the words after the block', () => {
    const html = document({ highlight: 'crash' })
    expect(html).toContain(
      `<span>The <span data-role="highlight" ${BLOCK}>crash</span> nobody saw</span>`,
    )
  })

  it('the type size does not change with a highlight', () => {
    expect(document({ highlight: '' })).toContain('font-size:160px')
    expect(document({ highlight: 'crash' })).toContain('font-size:160px')
  })

  it('escapes the highlighted words', () => {
    const html = document({ headline: 'Say <b> "&" now', highlight: '<b> "&"' })
    expect(html).toMatch(/data-role="highlight"[^>]*>&lt;b&gt;<\/span>/)
    expect(html).toMatch(/data-role="highlight"[^>]*>&quot;&amp;&quot;<\/span>/)
    expect(html).not.toContain('<b>')
  })

  it('a highlight that is not in the headline draws the plain headline', () => {
    expect(document({ highlight: 'bankrupt' })).toEqual(document({ highlight: '' }))
  })
})

describe('highlightInk', () => {
  it('the type on the block follows the higher contrast', () => {
    const light = highlightInk(brandWith('#f5a524'))
    expect(light.color).toBe('#101418')
    expect(light.contrast!).toBeGreaterThan(4.5)
    const dark = highlightInk(brandWith('#3a0d0d'))
    expect(dark.color).toBe('#f4f1ea')
    expect(dark.contrast!).toBeGreaterThan(4.5)
  })

  it('an unreadable colour is not a warning', () => {
    expect(highlightInk(brandWith('not-a-colour'))).toEqual({ color: '#101418', contrast: null })
  })
})

describe('headlineTextNodes', () => {
  it("counts the headline's text nodes", () => {
    expect(headlineTextNodes('', 'x')).toBe(0)
    expect(headlineTextNodes('The crash nobody saw', '')).toBe(1)
    expect(headlineTextNodes('The crash nobody saw', 'crash')).toBe(3)
    expect(headlineTextNodes('They lost $2 billion', '2 billion')).toBe(3)
    expect(headlineTextNodes('Bankrupt', 'bankrupt')).toBe(1)
  })

  it("the headline's boxes are all of its text nodes", () => {
    const boxes = [
      box({ node: 1, text: 'THE' }),
      box({ node: 2, text: 'CRASH' }),
      box({ node: 3, text: 'NOBODY SAW', y: 300 }),
      box({ node: 3, text: 'NOBODY SAW', x: 1400, y: 950, width: 100, height: 60 }),
      box({ node: 5, text: 'BOOM & BUSTERS', x: 77, y: 43 }),
    ]
    const own = headlineBoxes(boxes, 3)
    expect(own).toEqual(boxes.slice(0, 4))
    expect(thumbnailWarnings({ ...OK, headline: 'The crash nobody saw', boxes: own })).toContain(
      'The headline sits where YouTube draws the duration.',
    )
    expect(headlineBoxes(boxes)).toEqual([boxes[0]])
    expect(headlineBoxes(boxes, 0)).toEqual([])
  })
})

describe('the highlight warning', () => {
  it('warns when the highlighted words do not stand out', () => {
    const warning = 'The highlighted words do not stand out enough from the accent colour.'
    expect(thumbnailWarnings({ ...OK, highlightContrast: 4.4 })).toContain(warning)
    expect(thumbnailWarnings({ ...OK, highlightContrast: 4.5 })).not.toContain(warning)
    expect(thumbnailWarnings({ ...OK, highlightContrast: null })).not.toContain(warning)
    expect(thumbnailWarnings(OK)).not.toContain(warning)
  })
})

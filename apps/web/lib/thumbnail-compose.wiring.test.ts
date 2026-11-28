import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextBox } from './graphic-code/frames'
import { contrastRatio } from './graphic-code/page-pure'

// The browser is replaced, so these tests prove only what composeThumbnail
// does with the boxes it is given. The real-browser tests are in
// thumbnail-compose.test.ts, which this mock cannot reach.
const screenshotFrame = vi.fn()
vi.mock('./graphic-code/frames', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  screenshotFrame: (...args: unknown[]) => screenshotFrame(...args),
}))

import { composeThumbnail } from './thumbnail-compose'

const DURATION = 'The headline sits where YouTube draws the duration.'
const ACCENT = 'The highlighted words do not stand out enough from the accent colour.'

function box(over: Partial<TextBox>): TextBox {
  return {
    node: 1,
    text: 'THE',
    x: 60,
    y: 100,
    width: 300,
    height: 200,
    fontPx: 200,
    opacity: 1,
    moving: false,
    color: 'rgb(244, 241, 234)',
    ground: null,
    ...over,
  }
}

/** The page of `The crash nobody saw` with `crash` highlighted: three headline nodes, then a wordmark. */
function page(over: { last?: Partial<TextBox>; wordmark?: Partial<TextBox> }): TextBox[] {
  return [
    box({ node: 1, text: 'THE' }),
    box({ node: 2, text: 'CRASH', y: 320 }),
    box({ node: 3, text: 'NOBODY SAW', y: 540, ...over.last }),
    box({ node: 5, text: 'BOOM & BUSTERS', x: 60, y: 40, height: 80, ...over.wordmark }),
  ]
}

const BRAND = {
  colors: { background: '#101418', textPrimary: '#f4f1ea', accent: '#f5a524' },
  fonts: { heading: 'Anton', body: 'Inter' },
} as unknown as Parameters<typeof composeThumbnail>[0]['brand']

// An accent that neither the background nor the text colour reads on.
const MUDDY = {
  colors: { background: '#777777', textPrimary: '#8a8a8a', accent: '#808080' },
  fonts: { heading: 'Anton', body: 'Inter' },
} as unknown as Parameters<typeof composeThumbnail>[0]['brand']

function compose(over: Partial<Parameters<typeof composeThumbnail>[0]> = {}) {
  return composeThumbnail({
    pictureSrc: 'data:image/png;base64,AAAA',
    headline: 'The crash nobody saw',
    highlight: 'crash',
    textSide: 'left',
    brand: BRAND,
    mark: { wordmark: 'Boom & Busters' },
    markPlacement: 'tl',
    ...over,
  })
}

function shows(boxes: TextBox[]) {
  screenshotFrame.mockResolvedValue({ jpeg: Buffer.from('jpeg'), boxes })
}

beforeEach(() => {
  screenshotFrame.mockReset()
})

describe('composeThumbnail wiring', () => {
  it('the warnings read every text node of a highlighted headline', async () => {
    shows(page({ last: { x: 1400, y: 950, width: 400, height: 100 } }))
    const { warnings } = await compose()
    expect(warnings).toContain(DURATION)
  })

  it('a wordmark is not read as the headline', async () => {
    shows(page({ last: { x: 60, y: 540 }, wordmark: { x: 1600, y: 950 } }))
    const { warnings } = await compose()
    expect(warnings).not.toContain(DURATION)
  })

  it('warns when the accent leaves the highlighted words unreadable', async () => {
    const { colors } = MUDDY
    expect(contrastRatio(colors.background, colors.accent)).toBeLessThan(4.5)
    expect(contrastRatio(colors.textPrimary, colors.accent)).toBeLessThan(4.5)
    shows(page({ last: { x: 60, y: 540 } }))
    const { warnings } = await compose({ brand: MUDDY })
    expect(warnings).toContain(ACCENT)
  })

  it('no highlight, no accent warning', async () => {
    shows([box({ node: 1, text: 'THE CRASH NOBODY SAW' })])
    const { warnings } = await compose({ brand: MUDDY, highlight: '' })
    expect(warnings).not.toContain(ACCENT)
  })
})

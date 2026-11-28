import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { DEFAULT_SETTINGS, THUMB_HEIGHT, THUMB_WIDTH, resolveBrandKit } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { FramesUnavailable, screenshotFrame } from './graphic-code/frames'
import { rgbOf } from './graphic-code/page-pure'
import { composeThumbnail } from './thumbnail-compose'
import {
  headlineBoxes,
  headlineTextNodes,
  highlightInk,
  thumbnailDocument,
} from './thumbnail-document'

const brand = graphicBrand(
  resolveBrandKit(DEFAULT_SETTINGS, { name: 'Boom & Busters', handle: '@boombusters' }),
)

const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"><rect width="100%" height="100%" fill="#336699"/></svg>`,
)}`

function page(headline: string, highlight: string, textSide: 'left' | 'right') {
  return thumbnailDocument({
    pictureSrc: PICTURE,
    headline,
    textSide,
    brand,
    mark: { wordmark: 'Boom & Busters' },
    markPlacement: 'tl',
    highlight,
  })
}

async function photograph(headline: string, highlight: string, textSide: 'left' | 'right') {
  return screenshotFrame({
    html: page(headline, highlight, textSide),
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
  })
}

/** A browser is there to drive: Playwright's own download, or the path the host sets. */
async function browserAvailable(): Promise<boolean> {
  try {
    await screenshotFrame({
      html: page('Bankrupt', '', 'left'),
      width: THUMB_WIDTH,
      height: THUMB_HEIGHT,
    })
    return true
  } catch (error) {
    if (error instanceof FramesUnavailable) return false
    throw error
  }
}

/** The headline's lines as [left, right] extents, by rounded top. */
function lines(boxes: ReturnType<typeof headlineBoxes>): [number, number][] {
  const byY = new Map<number, [number, number]>()
  for (const box of boxes) {
    const y = Math.round(box.y)
    const left = box.x
    const right = box.x + box.width
    const seen = byY.get(y)
    byY.set(y, seen ? [Math.min(seen[0], left), Math.max(seen[1], right)] : [left, right])
  }
  return [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, [left, right]]) => [Math.round(left), Math.round(right)])
}

describe.skipIf(!(await browserAvailable()))('a highlighted thumbnail in a real browser', () => {
  it('a highlight never moves a letter', async () => {
    const cases: [string, string, 'left' | 'right'][] = [
      ['Bankrupt', 'bankrupt', 'left'],
      ['The crash nobody saw', 'crash', 'left'],
      ['They lost $2 billion', '2 billion', 'left'],
      ['Nobody checked the books', 'checked', 'right'],
    ]
    for (const [headline, highlight, side] of cases) {
      const plain = await photograph(headline, '', side)
      const marked = await photograph(headline, highlight, side)
      const before = lines(headlineBoxes(plain.boxes, headlineTextNodes(headline, '')))
      const after = lines(headlineBoxes(marked.boxes, headlineTextNodes(headline, highlight)))
      expect(after, headline).toEqual(before)
    }
  }, 60_000)

  it('the highlighted words report their block', async () => {
    const { boxes } = await photograph('The crash nobody saw', 'crash', 'left')
    const hit = boxes.find((candidate) => candidate.text === 'crash')
    expect(hit).toBeDefined()
    expect(rgbOf(hit!.ground ?? '')).toEqual(rgbOf(brand.colors.accent))
    expect(rgbOf(hit!.color)).toEqual(rgbOf(highlightInk(brand).color))
  }, 60_000)

  it('a good highlighted headline composes without warnings', async () => {
    const { jpeg, warnings } = await composeThumbnail({
      pictureSrc: PICTURE,
      headline: 'The crash nobody saw',
      textSide: 'left',
      brand,
      mark: { wordmark: 'Boom & Busters' },
      markPlacement: 'tl',
      highlight: 'crash',
    })
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(warnings).toEqual([])
  }, 60_000)
})

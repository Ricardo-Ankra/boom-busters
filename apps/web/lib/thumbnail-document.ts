import { AVAILABLE_FONTS } from '@boom-busters/compositions/fonts'
import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import {
  HEADLINE_CONTRAST_MIN,
  HEADLINE_MIN_PX,
  HEADLINE_WORDS_MAX,
  THUMB_HEIGHT,
  THUMB_KEEP_OUT,
  THUMB_MARK_ALPHA,
  THUMB_MARK_HEIGHT_RATIO,
  THUMB_WIDTH,
  headlineWords,
} from '@boom-busters/schemas'
import type { TextBox } from './graphic-code/frames'
import { contrastRatio, fontsHref, rgbOf } from './graphic-code/page-pure'

/**
 * The thumbnail's page: the picture the image model painted (no text), then
 * the headline and the channel's mark set over it. Pure, so a client
 * component and the tests can import it; `thumbnail-compose.ts` photographs it.
 */

/** How much of the brand background the scrim lays over the picture. */
export const SCRIM_ALPHA = 0.72

const HEADLINE_MAX_PX = 220
const HEADLINE_FULL_AT_CHARS = 8
const HEADLINE_FLOOR_AT_CHARS = 28
/** The headline lives in the outer 44% of the width on its side: a 3% margin and 41% of text. */
const HEADLINE_MARGIN_PCT = 3
const HEADLINE_WIDTH_PCT = 41
/** Its box ends where the keep-out begins: 16% of the height is left under it. */
const HEADLINE_BOTTOM_PCT = Math.round((1 - THUMB_KEEP_OUT.top) * 100)
/** The scrim is solid across the text's 44% and fades out by 60%. */
const SCRIM_SOLID_PCT = 44
const SCRIM_FADE_PCT = 60
const MARK_INSET_PX = Math.round(0.04 * THUMB_HEIGHT)
const MARK_HEIGHT_PX = Math.round(THUMB_MARK_HEIGHT_RATIO * THUMB_HEIGHT)
const MARK_MAX_WIDTH_PX = Math.round(0.22 * THUMB_WIDTH)
/** The wordmark is set at half the mark's height: the film's corner watermark look, at the thumbnail's size. */
const WORDMARK_PX = Math.round(MARK_HEIGHT_PX / 2)

/** The heaviest weight cap: beyond this the headline would crowd its box. */
const HEADLINE_WEIGHT_MAX = 800
const HEADLINE_WEIGHT_UNKNOWN = 700

/**
 * The headline's weight from the font catalogue: the heaviest the face offers,
 * capped at 800. A single-weight display face gets its own weight, never a
 * synthesised bold; a face the catalogue does not hold gets 700.
 */
export function headlineWeight(
  family: string,
  catalogue: readonly { family: string; weights: readonly number[] }[] = AVAILABLE_FONTS,
): number {
  const known = catalogue.find((font) => font.family === family)
  if (!known || known.weights.length === 0) return HEADLINE_WEIGHT_UNKNOWN
  return Math.min(HEADLINE_WEIGHT_MAX, Math.max(...known.weights))
}

/** 220 px for up to 8 characters, falling linearly to the floor at 28, never below it. */
export function headlineFontPx(headline: string): number {
  const length = headline.trim().length
  if (length <= HEADLINE_FULL_AT_CHARS) return HEADLINE_MAX_PX
  if (length >= HEADLINE_FLOOR_AT_CHARS) return HEADLINE_MIN_PX
  const share =
    (length - HEADLINE_FULL_AT_CHARS) / (HEADLINE_FLOOR_AT_CHARS - HEADLINE_FULL_AT_CHARS)
  return Math.max(
    HEADLINE_MIN_PX,
    Math.round(HEADLINE_MAX_PX - share * (HEADLINE_MAX_PX - HEADLINE_MIN_PX)),
  )
}

/**
 * The lower of the type's contrast against the scrim colour laid over white
 * and over black: the picture behind the scrim can be either, so the worse
 * of the two is what the headline can count on. Null when a colour is unreadable.
 */
export function scrimContrast(
  text: string,
  background: string,
  alpha = SCRIM_ALPHA,
): number | null {
  const bg = rgbOf(background)
  if (!bg) return null
  const over = (base: number) => {
    const mix = (channel: number) => Math.round(alpha * channel + (1 - alpha) * base)
    return `rgb(${mix(bg.r)}, ${mix(bg.g)}, ${mix(bg.b)})`
  }
  const overWhite = contrastRatio(text, over(255))
  const overBlack = contrastRatio(text, over(0))
  if (overWhite === null || overBlack === null) return null
  return Math.min(overWhite, overBlack)
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** The mark's corner; never bottom right, where YouTube draws the duration. */
function markCorner(placement: 'tl' | 'tr' | 'bl'): string {
  const vertical = placement === 'bl' ? 'bottom' : 'top'
  const horizontal = placement === 'tr' ? 'right' : 'left'
  return `${vertical}:${MARK_INSET_PX}px;${horizontal}:${MARK_INSET_PX}px`
}

export function thumbnailDocument(input: {
  pictureSrc: string
  headline: string
  textSide: 'left' | 'right'
  brand: GraphicProps['brand']
  mark: { src: string } | { wordmark: string } | null
  markPlacement: 'none' | 'tl' | 'tr' | 'bl'
}): string {
  const { brand, textSide } = input
  const headline = input.headline.trim()
  const href = fontsHref(brand.fonts)
  const rgb = rgbOf(brand.colors.background) ?? { r: 0, g: 0, b: 0 }
  const scrimColour = `rgba(${rgb.r},${rgb.g},${rgb.b},${SCRIM_ALPHA})`
  const toward = textSide === 'left' ? 'right' : 'left'
  const heading = escapeHtml(brand.fonts.heading)

  const scrim =
    headline === ''
      ? ''
      : `<div data-role="scrim" style="position:absolute;inset:0;background:linear-gradient(to ${toward},${scrimColour} 0%,${scrimColour} ${SCRIM_SOLID_PCT}%,rgba(${rgb.r},${rgb.g},${rgb.b},0) ${SCRIM_FADE_PCT}%)"></div>`

  const text =
    headline === ''
      ? ''
      : `<div data-role="headline" style="position:absolute;top:0;bottom:${HEADLINE_BOTTOM_PCT}%;${textSide}:${HEADLINE_MARGIN_PCT}%;width:${HEADLINE_WIDTH_PCT}%;display:flex;align-items:center;justify-content:${textSide === 'left' ? 'flex-start' : 'flex-end'};text-align:${textSide};font-family:'${heading}',sans-serif;font-size:${headlineFontPx(headline)}px;line-height:0.95;font-weight:${headlineWeight(brand.fonts.heading)};text-transform:uppercase;color:${brand.colors.textPrimary}"><span>${escapeHtml(headline)}</span></div>`

  let mark = ''
  if (input.mark !== null && input.markPlacement !== 'none') {
    const corner = markCorner(input.markPlacement)
    mark =
      'src' in input.mark
        ? `<img data-role="mark" src="${escapeHtml(input.mark.src)}" alt="" style="position:absolute;${corner};height:${MARK_HEIGHT_PX}px;max-width:${MARK_MAX_WIDTH_PX}px;object-fit:contain;opacity:${THUMB_MARK_ALPHA}">`
        : `<div data-role="mark" style="position:absolute;${corner};font-family:'${heading}',sans-serif;font-size:${WORDMARK_PX}px;letter-spacing:0.08em;text-transform:uppercase;white-space:nowrap;opacity:${THUMB_MARK_ALPHA};color:${brand.colors.textPrimary}">${escapeHtml(input.mark.wordmark)}</div>`
  }

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    href ? `<link rel="stylesheet" href="${href}">` : '',
    '<style>*{box-sizing:border-box}html,body{margin:0;padding:0;overflow:hidden}',
    `body{width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;background:${brand.colors.background}}`,
    `#frame{position:relative;width:${THUMB_WIDTH}px;height:${THUMB_HEIGHT}px;overflow:hidden}</style>`,
    '</head><body><div id="frame">',
    `<img src="${escapeHtml(input.pictureSrc)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`,
    scrim,
    text,
    mark,
    '</div></body></html>',
  ].join('')
}

/**
 * The headline's boxes out of a page's text boxes: those of the first text
 * node. The headline is the first text in the page; the wordmark, when there
 * is one, comes after it and is not the headline's to answer for.
 */
export function headlineBoxes(boxes: readonly TextBox[]): TextBox[] {
  const first = boxes[0]
  return first === undefined ? [] : boxes.filter((candidate) => candidate.node === first.node)
}

/** What to tell the owner about a composed headline, in the console's own words. */
export function thumbnailWarnings(input: {
  headline: string
  fontPx: number
  boxes: readonly TextBox[]
  contrast: number | null
}): string[] {
  if (input.headline.trim() === '') return []
  const warnings: string[] = []
  const words = headlineWords(input.headline)
  if (words > HEADLINE_WORDS_MAX) {
    warnings.push(`The headline is ${words} words; four is the ceiling.`)
  }
  if (input.fontPx < HEADLINE_MIN_PX) warnings.push("The headline's type is under the size floor.")
  if (input.contrast !== null && input.contrast < HEADLINE_CONTRAST_MIN) {
    warnings.push('The headline does not stand out enough from what is behind it.')
  }
  const outside = input.boxes.some(
    (box) =>
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > THUMB_WIDTH ||
      box.y + box.height > THUMB_HEIGHT,
  )
  if (outside) warnings.push('The headline runs outside the frame.')
  const keepOutLeft = THUMB_KEEP_OUT.left * THUMB_WIDTH
  const keepOutTop = THUMB_KEEP_OUT.top * THUMB_HEIGHT
  const entersKeepOut = input.boxes.some(
    (box) => box.x + box.width > keepOutLeft && box.y + box.height > keepOutTop,
  )
  if (entersKeepOut) warnings.push('The headline sits where YouTube draws the duration.')
  return warnings
}

import sharp from 'sharp'
import type { SetPlateDirection } from '@boom-busters/schemas'

/**
 * Cutting a set's contact sheet into its four views (decision 275). The
 * sheet is asked for with thin white borders; the cut is made where those
 * borders are found, never at a guessed half, because a panel cut through
 * the middle of a room becomes a plate that teaches every later still a
 * seam. No clear border, no cut: the caller says so and the owner builds it
 * again.
 */

export interface SheetPanel {
  direction: SetPlateDirection
  bytes: Buffer
  width: number
  height: number
}

/** Mean luminance at or above this, across a whole row or column, is border. */
const WHITE = 235
/** A gutter narrower than this is a highlight, not a border. */
const MIN_GUTTER = 4

/** The widest run of white lines between `from` and `to`, or null. */
function band(
  means: Float64Array,
  from: number,
  to: number,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null
  let start = -1
  for (let at = from; at <= to; at += 1) {
    const white = at < to && means[at]! >= WHITE
    if (white && start === -1) start = at
    if (!white && start !== -1) {
      if (!best || at - start > best.end - best.start) best = { start, end: at }
      start = -1
    }
  }
  return best && best.end - best.start >= MIN_GUTTER && best.start > from && best.end < to
    ? best
    : null
}

/** First index from the start (or the end) that is not white: the outer border's edge. */
function edge(means: Float64Array, fromEnd: boolean): number {
  const n = means.length
  for (let step = 0; step < n; step += 1) {
    const at = fromEnd ? n - 1 - step : step
    if (means[at]! < WHITE) return fromEnd ? at + 1 : at
  }
  return fromEnd ? n : 0
}

export async function splitContactSheet(input: Buffer): Promise<SheetPanel[] | null> {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const rows = new Float64Array(height)
  const cols = new Float64Array(width)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[(y * width + x) * channels]!
      rows[y] = rows[y]! + value
      cols[x] = cols[x]! + value
    }
  }
  for (let y = 0; y < height; y += 1) rows[y] = rows[y]! / width
  for (let x = 0; x < width; x += 1) cols[x] = cols[x]! / height

  const across = band(rows, Math.floor(height * 0.4), Math.ceil(height * 0.6))
  const down = band(cols, Math.floor(width * 0.4), Math.ceil(width * 0.6))
  if (!across || !down) return null

  const top = edge(rows, false)
  const bottom = edge(rows, true)
  const left = edge(cols, false)
  const right = edge(cols, true)

  const boxes: {
    direction: SetPlateDirection
    left: number
    top: number
    width: number
    height: number
  }[] = [
    { direction: 'north', left, top, width: down.start - left, height: across.start - top },
    { direction: 'east', left: down.end, top, width: right - down.end, height: across.start - top },
    {
      direction: 'south',
      left,
      top: across.end,
      width: down.start - left,
      height: bottom - across.end,
    },
    {
      direction: 'west',
      left: down.end,
      top: across.end,
      width: right - down.end,
      height: bottom - across.end,
    },
  ]
  if (boxes.some((box) => box.width < 16 || box.height < 16)) return null

  return Promise.all(
    boxes.map(async (box) => ({
      direction: box.direction,
      width: box.width,
      height: box.height,
      bytes: await sharp(input)
        .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
        .png()
        .toBuffer(),
    })),
  )
}

/** The sheet mock mode "generates": four grey panels with white gutters. */
export async function mockContactSheet(): Promise<Buffer> {
  const pw = 316
  const ph = 176
  const tile = (shade: number) =>
    sharp({
      create: { width: pw, height: ph, channels: 3, background: { r: shade, g: shade, b: shade } },
    })
      .png()
      .toBuffer()
  const tiles = await Promise.all([tile(80), tile(110), tile(140), tile(170)])
  return sharp({ create: { width: 640, height: 360, channels: 3, background: '#ffffff' } })
    .composite([
      { input: tiles[0]!, left: 0, top: 0 },
      { input: tiles[1]!, left: pw + 8, top: 0 },
      { input: tiles[2]!, left: 0, top: ph + 8 },
      { input: tiles[3]!, left: pw + 8, top: ph + 8 },
    ])
    .png()
    .toBuffer()
}

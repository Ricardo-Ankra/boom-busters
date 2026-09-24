import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { mockContactSheet, splitContactSheet } from './contact-sheet'

/** A sheet: four grey panels on white, `gutter` px apart, `border` px of white round the edge. */
async function sheet(options: {
  width?: number
  height?: number
  gutter?: number
  border?: number
  panel?: number
}): Promise<Buffer> {
  const { width = 800, height = 450, gutter = 8, border = 0, panel = 90 } = options
  const inner = { w: width - 2 * border, h: height - 2 * border }
  const pw = Math.floor((inner.w - gutter) / 2)
  const ph = Math.floor((inner.h - gutter) / 2)
  const tile = (shade: number) =>
    sharp({
      create: { width: pw, height: ph, channels: 3, background: { r: shade, g: shade, b: shade } },
    })
      .png()
      .toBuffer()
  const tiles = await Promise.all([
    tile(panel),
    tile(panel + 20),
    tile(panel + 40),
    tile(panel + 60),
  ])
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: tiles[0]!, left: border, top: border },
      { input: tiles[1]!, left: border + pw + gutter, top: border },
      { input: tiles[2]!, left: border, top: border + ph + gutter },
      { input: tiles[3]!, left: border + pw + gutter, top: border + ph + gutter },
    ])
    .png()
    .toBuffer()
}

describe('splitContactSheet', () => {
  it('cuts a clean sheet into four panels, north east south west', async () => {
    const panels = await splitContactSheet(await sheet({}))
    expect(panels?.map((panel) => panel.direction)).toEqual(['north', 'east', 'south', 'west'])
    for (const panel of panels ?? []) {
      expect(panel.width).toBe(396)
      expect(panel.height).toBe(221)
    }
    // Each panel is the right tile: the south panel is the third shade.
    const south = await sharp(panels![2]!.bytes).greyscale().raw().toBuffer()
    expect(south[0]).toBe(130)
  })

  it('trims a white outer border', async () => {
    const panels = await splitContactSheet(await sheet({ border: 12 }))
    expect(panels).toHaveLength(4)
    expect(panels![0]!.width).toBe(384)
  })

  it('refuses a sheet with no gutter rather than guessing', async () => {
    const plain = await sharp({
      create: { width: 800, height: 450, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .png()
      .toBuffer()
    expect(await splitContactSheet(plain)).toBeNull()
  })

  it('refuses a gutter outside the middle of the sheet', async () => {
    const lopsided = await sharp({
      create: { width: 800, height: 450, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 800, height: 8, channels: 3, background: '#ffffff' },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 60,
        },
      ])
      .png()
      .toBuffer()
    expect(await splitContactSheet(lopsided)).toBeNull()
  })

  // Review Focus 4: a pale room must not read as a gutter.
  it('finds the real gutter in a sheet of pale panels', async () => {
    // Shades 170, 190, 210 and 230: pale, but under the 235 border threshold.
    const panels = await splitContactSheet(await sheet({ panel: 170 }))
    expect(panels).toHaveLength(4)
    expect(panels![0]!.width).toBe(396)
  })

  it('splits its own mock sheet', async () => {
    expect(await splitContactSheet(await mockContactSheet())).toHaveLength(4)
  })

  // Fix 1: all-white image must return null, not crop to nothing
  it('refuses an all-white image', async () => {
    const allWhite = await sharp({
      create: { width: 800, height: 450, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .png()
      .toBuffer()
    expect(await splitContactSheet(allWhite)).toBeNull()
  })

  // Fix round 3: a horizontal white gutter that begins exactly at the search
  // window's lower bound is not a bounded band. This sheet has a genuine,
  // fully-bounded vertical gutter (columns 392..399, inside the window
  // [320, 480]) so `down` passes on both old and new code; the horizontal
  // gutter (rows 180..187) starts exactly at floor(450 * 0.4) = 180, the
  // window's own lower bound. Without the `best.start > from && best.end <
  // to` guard, `band()` still returns that run as `across` (a real band, no
  // different from any other), every panel clears the 16px minimum, and the
  // sheet is split into four; with the guard, `across` is refused because
  // its run starts at the edge of the search window rather than inside it,
  // and splitContactSheet returns null.
  it('refuses a horizontal gutter that begins at the edge of the search window', async () => {
    const tile = (shade: number, w: number, h: number) =>
      sharp({
        create: { width: w, height: h, channels: 3, background: { r: shade, g: shade, b: shade } },
      })
        .png()
        .toBuffer()
    const tiles = await Promise.all([
      tile(90, 392, 180), // north: left panels width 392, top panels height 180
      tile(110, 400, 180), // east: right panels width 400
      tile(130, 392, 262), // south: bottom panels height 262 (rows 188..449)
      tile(150, 400, 262), // west
    ])
    const boundary = await sharp({
      create: { width: 800, height: 450, channels: 3, background: '#ffffff' },
    })
      .composite([
        { input: tiles[0]!, left: 0, top: 0 },
        { input: tiles[1]!, left: 400, top: 0 },
        { input: tiles[2]!, left: 0, top: 188 },
        { input: tiles[3]!, left: 400, top: 188 },
      ])
      .png()
      .toBuffer()
    expect(await splitContactSheet(boundary)).toBeNull()
  })
})

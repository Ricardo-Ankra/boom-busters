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

  // Fix 2: a white band at the search window boundary is not a valid gutter
  it('refuses a 2x2 sheet with gutter at search window boundary', async () => {
    // Real 2x2 sheet: four grey panels with white gutters. Vertical gutter near middle (normal),
    // horizontal gutter starting exactly at the search window lower bound (180 = floor(450*0.4)).
    // Old code finds both bands and splits; fixed code rejects the horizontal band because
    // it starts at the window edge, not bounded by content within the window.
    const pw = 396 // Panel width: top-left and top-right
    const ph = 180 // Panel height: top row
    const ph2 = 263 // Panel height: bottom row (450 - 187 = 263)
    const tile = (shade: number, w: number, h: number) =>
      sharp({
        create: { width: w, height: h, channels: 3, background: { r: shade, g: shade, b: shade } },
      })
        .png()
        .toBuffer()
    const panels = await Promise.all([
      tile(90, pw, ph),
      tile(90, 404, ph), // 404 = 800 - 396
      tile(90, pw, ph2),
      tile(90, 404, ph2),
    ])
    expect(
      await splitContactSheet(
        await sharp({ create: { width: 800, height: 450, channels: 3, background: '#ffffff' } })
          .composite([
            { input: panels[0]!, left: 0, top: 0 }, // top-left
            { input: panels[1]!, left: 396, top: 0 }, // top-right
            { input: panels[2]!, left: 0, top: 187 }, // bottom-left (gutter rows 180-187)
            { input: panels[3]!, left: 396, top: 187 }, // bottom-right
          ])
          .png()
          .toBuffer(),
      ),
    ).toBeNull()
  })
})

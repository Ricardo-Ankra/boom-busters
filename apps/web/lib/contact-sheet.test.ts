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
})

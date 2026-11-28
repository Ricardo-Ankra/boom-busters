// @vitest-environment node

import sharp, { type OverlayOptions } from 'sharp'
import { describe, expect, it } from 'vitest'
import { trimmedMark } from './thumbnail-mark'

const RED = { r: 200, g: 30, b: 30, alpha: 1 }
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

/** A 100 by 100 transparent PNG with an opaque 40 by 30 block at left 20, top 10. */
async function padded(extra: OverlayOptions[] = []): Promise<Buffer> {
  const block = await sharp({ create: { width: 40, height: 30, channels: 4, background: RED } })
    .png()
    .toBuffer()
  return sharp({ create: { width: 100, height: 100, channels: 4, background: CLEAR } })
    .composite([{ input: block, left: 20, top: 10 }, ...extra])
    .png()
    .toBuffer()
}

async function sizeOf(bytes: Buffer): Promise<{ width?: number; height?: number }> {
  const { width, height } = await sharp(bytes).metadata()
  return { width, height }
}

describe('trimmedMark', () => {
  it('crops a padded mark to its glyph', async () => {
    const out = await trimmedMark(await padded())
    expect(out).not.toBeNull()
    expect(await sizeOf(out!)).toEqual({ width: 40, height: 30 })
    expect((await sharp(out!).metadata()).format).toBe('png')
  })

  it('ignores pixels too faint to see', async () => {
    const faint = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 4 / 255 },
      },
    })
      .png()
      .toBuffer()
    const out = await trimmedMark(await padded([{ input: faint, left: 99, top: 99 }]))
    expect(await sizeOf(out!)).toEqual({ width: 40, height: 30 })
  })

  it('a mark with no padding is used as it is', async () => {
    const solid = await sharp({ create: { width: 50, height: 40, channels: 4, background: RED } })
      .png()
      .toBuffer()
    expect(await trimmedMark(solid)).toBeNull()
  })

  it('a mark with no alpha channel is used as it is', async () => {
    const background = { r: 10, g: 10, b: 10 }
    const jpeg = await sharp({ create: { width: 50, height: 40, channels: 3, background } })
      .jpeg()
      .toBuffer()
    const opaque = await sharp({ create: { width: 50, height: 40, channels: 3, background } })
      .png()
      .toBuffer()
    expect(await trimmedMark(jpeg)).toBeNull()
    expect(await trimmedMark(opaque)).toBeNull()
  })

  it('an empty mark is used as it is', async () => {
    const empty = await sharp({ create: { width: 30, height: 30, channels: 4, background: CLEAR } })
      .png()
      .toBuffer()
    expect(await trimmedMark(empty)).toBeNull()
  })

  it('bytes that are not an image are used as they are', async () => {
    await expect(trimmedMark(Buffer.from('not an image'))).resolves.toBeNull()
  })
})

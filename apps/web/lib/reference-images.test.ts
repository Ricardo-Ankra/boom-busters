// @vitest-environment node

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { imageForModel, MODEL_IMAGE_MAX_WIDTH } from './reference-images'

/**
 * A frame shown to the model is held to a width the API accepts (final
 * review, issue 6): a still is stored up to 8 MB, and the vision call refuses
 * an image over 5 MB.
 */

describe('imageForModel', () => {
  it('shrinks a wide PNG to the model width as a JPEG', async () => {
    const png = await sharp({
      create: { width: 3000, height: 1500, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer()
    const image = await imageForModel({ bytes: png, contentType: 'image/png' })
    expect(image.mimeType).toBe('image/jpeg')
    const meta = await sharp(Buffer.from(image.data, 'base64')).metadata()
    expect(meta.width).toBe(MODEL_IMAGE_MAX_WIDTH)
    expect(meta.height).toBe(MODEL_IMAGE_MAX_WIDTH / 2)
  })

  it('passes a small JPEG through untouched', async () => {
    const jpeg = await sharp({
      create: { width: 640, height: 360, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer()
    const image = await imageForModel({ bytes: jpeg, contentType: 'image/jpeg' })
    expect(image.mimeType).toBe('image/jpeg')
    expect(Buffer.from(image.data, 'base64').equals(jpeg)).toBe(true)
  })
})

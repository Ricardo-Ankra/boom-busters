import { describe, expect, it } from 'vitest'
import {
  THUMBNAIL_RULES,
  THUMB_MAX_BYTES,
  thumbnailDimensionError,
  thumbnailHint,
} from './thumbnail-rules'

describe('thumbnailDimensionError', () => {
  it('accepts the Canva Shorts export that the master rule used to refuse', () => {
    // The bug: 1080 is under the master's 1280 width, so the correct vertical
    // thumbnail was blocked on Shorts (owner report, 2026-09-11).
    expect(thumbnailDimensionError('short', { width: 1080, height: 1920 })).toBeNull()
    expect(thumbnailDimensionError('short', { width: 2160, height: 3840 })).toBeNull()
  })

  it('still accepts a 16:9 master thumbnail', () => {
    expect(thumbnailDimensionError('master', { width: 1280, height: 720 })).toBeNull()
    expect(thumbnailDimensionError('master', { width: 3840, height: 2160 })).toBeNull()
  })

  it('refuses the wrong orientation for each target, without a ratio check', () => {
    // A landscape PNG fails a Short's height floor...
    expect(thumbnailDimensionError('short', { width: 1920, height: 1080 })).toMatch(/9:16/)
    // ...and a portrait one fails a master's width floor.
    expect(thumbnailDimensionError('master', { width: 1080, height: 1920 })).toMatch(/16:9/)
  })

  it('refuses anything under the floor and names what arrived', () => {
    expect(thumbnailDimensionError('master', { width: 800, height: 450 })).toContain('800×450')
    expect(thumbnailDimensionError('short', { width: 405, height: 720 })).toContain('405×720')
  })

  it('never blames YouTube for the app’s own floor', () => {
    const message = thumbnailDimensionError('short', { width: 320, height: 568 })
    expect(message).not.toMatch(/YouTube/)
  })

  it('clears YouTube’s documented minimum in both orientations', () => {
    // YouTube requires 640 on the short side: width for 16:9, height for 9:16.
    expect(THUMBNAIL_RULES.master.minWidth).toBeGreaterThanOrEqual(640)
    expect(THUMBNAIL_RULES.short.minHeight).toBeGreaterThanOrEqual(640)
  })

  it('keeps the API ceiling, which is lower than Studio’s web uploader', () => {
    expect(THUMB_MAX_BYTES).toBe(2 * 1024 * 1024)
  })
})

describe('thumbnailHint', () => {
  it('tells a Short it wants a vertical image, and never quotes 1280×720 at it', () => {
    const hint = thumbnailHint('short')
    expect(hint).toMatch(/optional for a Short/i)
    expect(hint).toMatch(/9:16/)
    expect(hint).toMatch(/1080×1920/)
    expect(hint).not.toMatch(/1280×720/)
  })

  it('tells a master it is required, and 16:9', () => {
    const hint = thumbnailHint('master')
    expect(hint).toMatch(/16:9/)
    expect(hint).toMatch(/1280×720/)
    expect(hint).toMatch(/need one before upload/i)
  })
})

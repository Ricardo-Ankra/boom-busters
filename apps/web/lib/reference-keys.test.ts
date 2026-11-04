import { describe, expect, it } from 'vitest'
import { referenceFrameKey, referenceKey, referenceSheetKey } from './reference-keys'

describe('reference keys (spec 2026-11-04, section 7.2)', () => {
  const base = { channelId: '01BB0000000000000000000001', contentHash: 'abc' }

  it('keys the original, its frames and its sheets under the channel and the hash', () => {
    expect(referenceKey({ ...base, ext: 'mp4' })).toBe(
      'boom-busters/references/01BB0000000000000000000001/abc.mp4',
    )
    expect(referenceFrameKey({ ...base, set: 'dense', atMs: 1083 })).toBe(
      'boom-busters/references/01BB0000000000000000000001/abc/dense/1083.jpg',
    )
    expect(referenceSheetKey({ ...base, sheet: 'contact' })).toBe(
      'boom-busters/references/01BB0000000000000000000001/abc/contact-sheet.jpg',
    )
  })
})

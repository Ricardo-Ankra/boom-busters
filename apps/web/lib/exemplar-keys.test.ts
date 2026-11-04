import { describe, expect, it } from 'vitest'
import { exemplarFrameKey, exemplarSheetKey } from './exemplar-keys'

describe('exemplar storage keys (spec 2026-11-04, section 9.2, step 3)', () => {
  it("names a version's frames and sheets by round and orientation", () => {
    expect(
      exemplarFrameKey({
        channelId: 'c1',
        versionId: 'v1',
        round: 2,
        orientation: 'landscape',
        atMs: 1350,
      }),
    ).toBe('boom-busters/exemplars/c1/v1/round-2/landscape-1350.jpg')
    expect(
      exemplarSheetKey({ channelId: 'c1', versionId: 'v1', round: 1, orientation: 'portrait' }),
    ).toBe('boom-busters/exemplars/c1/v1/round-1/portrait-sheet.jpg')
  })
})

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { renderSheets, sheetDocument, SHEET_COLUMNS, SHEET_WIDTH } from './reference-sheets'

/**
 * The two sheets a reference's frames are laid on for the reader and, in
 * later plans, the critic (spec 2026-11-04, sections 7.3 and 12.2): six
 * columns, a timecode under each tile, 1600 px wide.
 */

const storage = vi.hoisted(() => ({ configured: false }))
vi.mock('@/lib/storage', () => ({
  R2_PREFIX: 'boom-busters',
  storageConfigured: () => storage.configured,
  getObjectBytes: vi.fn(),
  putObject: vi.fn(),
}))

function tiles(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    atMs: Math.round(index * (1000 / 12)),
    dataUri: 'data:image/jpeg;base64,AAAA',
    width: 640,
    height: 360,
  }))
}

describe('sheetDocument', () => {
  it('lays the tiles in six columns with a timecode under each', () => {
    const html = sheetDocument(tiles(14))
    expect(SHEET_COLUMNS).toBe(6)
    expect(html).toContain(`grid-template-columns: repeat(${SHEET_COLUMNS}`)
    expect(html).toContain(`width: ${SHEET_WIDTH}px`)
    expect((html.match(/<img /g) ?? []).length).toBe(14)
    expect(html).toContain('1.08 s')
    expect(html).toContain('0.00 s')
  })
})

describe('renderSheets', () => {
  it('skips the sheets without storage and says so', async () => {
    storage.configured = false
    const result = await renderSheets({
      channelId: '01BB0000000000000000000001',
      referenceId: '01J000000000000000000000R1',
      frames: {
        dense: [{ atMs: 0, r2Key: 'k', width: 640, height: 360 }],
        overview: [],
      },
    })
    expect(result).toEqual({ denseSheetKey: null, contactSheetKey: null, skipped: 'no storage' })
  })
})

import type { ReferenceFrames } from '@boom-busters/schemas'
import { FramesUnavailable, INSPECT_MAX_MS, screenshotDocument } from '@/lib/graphic-code/frames'
import { referenceSheetKey } from '@/lib/reference-keys'
import { getObjectBytes, putObject, storageConfigured } from '@/lib/storage'

/**
 * A reference's two sheets (spec 2026-11-04, sections 7.3 and 12.2): the
 * dense sheet of the marked window's frames and the contact sheet of the
 * whole clip, each a six-column grid with the time under every tile,
 * 1600 px wide, photographed in the app's Chromium and stored beside the
 * frames. The reader is shown the dense sheet; the critic, in a later plan,
 * both. Without storage there are no frames to lay out, and the read runs on
 * the single frames instead.
 */

export const SHEET_WIDTH = 1600
export const SHEET_COLUMNS = 6
/** Bytes fetched at once when a sheet's frames are read back. */
const FETCH_BATCH = 8

export interface SheetTile {
  atMs: number
  dataUri: string
  width: number
  height: number
}

const timecode = (ms: number) => `${(ms / 1000).toFixed(2)} s`

/** The grid page: dark ground, six columns, a timecode under each tile. */
export function sheetDocument(tiles: readonly SheetTile[]): string {
  const cells = tiles
    .map(
      (tile) =>
        `<figure><img src="${tile.dataUri}" width="${tile.width}" height="${tile.height}" alt=""><figcaption>${timecode(tile.atMs)}</figcaption></figure>`,
    )
    .join('')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><style>',
    `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#141414}`,
    `body{width: ${SHEET_WIDTH}px}`,
    `main{display:grid;grid-template-columns: repeat(${SHEET_COLUMNS}, 1fr);gap:8px;padding:8px}`,
    'figure{margin:0;display:flex;flex-direction:column;gap:4px}',
    'img{display:block;width:100%;height:auto;background:#000}',
    'figcaption{font:14px system-ui, sans-serif;color:#f2f2f2;text-align:center}',
    '</style></head><body><main>',
    cells,
    '</main></body></html>',
  ].join('')
}

async function fetchTiles(frames: ReferenceFrames['dense']): Promise<SheetTile[]> {
  const tiles: SheetTile[] = []
  for (let at = 0; at < frames.length; at += FETCH_BATCH) {
    const batch = frames.slice(at, at + FETCH_BATCH)
    const fetched = await Promise.all(batch.map((frame) => getObjectBytes(frame.r2Key)))
    fetched.forEach((object, index) => {
      const frame = batch[index]!
      tiles.push({
        atMs: frame.atMs,
        dataUri: `data:${object.contentType};base64,${Buffer.from(object.bytes).toString('base64')}`,
        width: frame.width,
        height: frame.height,
      })
    })
  }
  return tiles
}

export interface SheetsResult {
  denseSheetKey: string | null
  contactSheetKey: string | null
  /** Why no sheet was made, when none was. */
  skipped?: string
}

/** Both sheets rendered and stored, or the reason they were not. Never throws. */
export async function renderSheets(reference: {
  channelId: string
  contentHash: string
  frames: ReferenceFrames
}): Promise<SheetsResult> {
  if (!storageConfigured())
    return { denseSheetKey: null, contactSheetKey: null, skipped: 'no storage' }
  const started = Date.now()
  const remaining = () => Math.max(1, INSPECT_MAX_MS - (Date.now() - started))
  const result: SheetsResult = { denseSheetKey: null, contactSheetKey: null }
  try {
    for (const [set, sheet] of [
      ['dense', 'dense'],
      ['overview', 'contact'],
    ] as const) {
      const frames = reference.frames[set]
      if (frames.length === 0) continue
      const jpeg = await screenshotDocument({
        html: sheetDocument(await fetchTiles(frames)),
        width: SHEET_WIDTH,
        timeoutMs: remaining(),
      })
      const key = referenceSheetKey({
        channelId: reference.channelId,
        contentHash: reference.contentHash,
        sheet,
      })
      await putObject(key, jpeg, 'image/jpeg')
      if (sheet === 'dense') result.denseSheetKey = key
      else result.contactSheetKey = key
    }
    return result
  } catch (error) {
    const reason = error instanceof FramesUnavailable ? error.message : String(error)
    return { ...result, skipped: reason }
  }
}

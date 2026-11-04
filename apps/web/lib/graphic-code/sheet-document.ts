/**
 * The sheet page (spec 2026-11-04, sections 7.3 and 12.2): a six-column grid
 * of tiles, 1600 px wide, a timecode under each, on a dark ground. The
 * reference sheets lay a clip's frames out with it; the designer's frames
 * lay the dense shots of a rendered design out with it for the critic. Pure,
 * so both can import it without either's storage or browser.
 */

export const SHEET_WIDTH = 1600
export const SHEET_COLUMNS = 6

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

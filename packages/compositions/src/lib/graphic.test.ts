import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, GRAPHIC_COLORS, resolveBrandKit } from '@boom-busters/schemas'
import type { GraphicCell, GraphicScene } from '@boom-busters/schemas'
import {
  countedValue,
  enterProgress,
  fitFontPx,
  graphicLayout,
  reflowPortrait,
  roleBasePx,
  safeArea,
  tokenColor,
} from './graphic'

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }

const scene: GraphicScene = {
  elements: [
    {
      kind: 'text',
      id: 't',
      cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
      content: 'Raised in one round',
      role: 'heading',
      color: 'textPrimary',
      align: 'start',
      enter: { kind: 'fade', atMs: 0 },
    },
    {
      kind: 'figure',
      id: 'f',
      cell: { col: 0, row: 2, colSpan: 6, rowSpan: 3 },
      value: '$4bn',
      label: 'valuation',
      claimRef: '01HQ00000000000000000000A1',
      color: 'accent',
      enter: { kind: 'count', atMs: 400 },
    },
    {
      kind: 'logo',
      id: 'l',
      cell: { col: 8, row: 0, colSpan: 4, rowSpan: 3 },
      entity: 'Stability AI',
      enter: { kind: 'rise', atMs: 200 },
    },
  ],
}

function pairwiseDisjointRows(cells: readonly GraphicCell[]): boolean {
  return cells.every((a, i) =>
    cells.slice(i + 1).every((b) => a.row + a.rowSpan <= b.row || b.row + b.rowSpan <= a.row),
  )
}

function shapeElement(id: string, row: number, rowSpan: number): GraphicScene['elements'][number] {
  return {
    kind: 'shape',
    id,
    cell: { col: 0, row, colSpan: 12, rowSpan },
    form: 'rect',
    color: 'surface',
    opacity: 1,
    enter: { kind: 'fade', atMs: 0 },
  }
}

describe('safeArea', () => {
  it('keeps clear of the caption band and the margin in both orientations', () => {
    const wide = safeArea(WIDE)
    expect(wide.x).toBe(36)
    expect(wide.y).toBe(36)
    expect(wide.w).toBe(1920 - 72)
    // Landscape captions end at 88% of the height. The bound is strict, not merely
    // touching the fraction boundary, so a version missing the caption band's own
    // buffer (which lands exactly on 1080 * 0.88) would fail here.
    expect(wide.y + wide.h).toBeLessThan(1080 * 0.88)
    expect(wide.y + wide.h).toBeLessThan(1080)
    const tall = safeArea(TALL)
    expect(tall.y + tall.h).toBeLessThan(1920 * 0.72)
    expect(tall.y + tall.h).toBeLessThan(1920)
  })
})

describe('graphicLayout', () => {
  it('places each element in its cells with the gutter, and fits text to its box', () => {
    const boxes = graphicLayout(scene, WIDE, brand)
    const [t, f, l] = boxes
    const safe = safeArea(WIDE)
    const cellW = safe.w / 12
    expect(t).toMatchObject({ id: 't', x: safe.x + 4, y: safe.y + 4 })
    expect(t!.w).toBeCloseTo(cellW * 6 - 8, 5)
    expect(l!.x).toBeCloseTo(safe.x + cellW * 8 + 4, 5)
    expect(t!.fontPx).toBeLessThanOrEqual(roleBasePx('heading'))
    expect(f!.fontPx).toBeLessThanOrEqual(roleBasePx('numbers'))
    expect(l!.fontPx).toBeUndefined()
  })

  it('re-flows elements without a portrait cell into one column on 9:16, in reading order', () => {
    const boxes = graphicLayout(scene, TALL, brand)
    const safe = safeArea(TALL)
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(safe.x + 4, 5)
      expect(box.w).toBeCloseTo(safe.w - 8, 5)
    }
    // The array itself stays in scene order (t, f, l); only the vertical placement
    // follows reading order, so look up by id rather than by array position.
    expect(boxes.map((box) => box.id)).toEqual(['t', 'f', 'l'])
    const byId = Object.fromEntries(boxes.map((box) => [box.id, box]))
    // Reading order is row then column: t (row 0) and l (row 0, col 8) before f (row 2).
    expect(byId.t!.y).toBeLessThan(byId.l!.y)
    expect(byId.l!.y).toBeLessThan(byId.f!.y)
  })

  it('keeps scene order in the returned array regardless of orientation', () => {
    const landscapeIds = graphicLayout(scene, WIDE, brand).map((box) => box.id)
    const portraitIds = graphicLayout(scene, TALL, brand).map((box) => box.id)
    expect(portraitIds).toEqual(landscapeIds)
  })

  it('honours a portrait cell when one is given', () => {
    const withPortrait: GraphicScene = {
      elements: [
        { ...scene.elements[2]!, portraitCell: { col: 4, row: 6, colSpan: 4, rowSpan: 2 } },
      ],
    }
    const [box] = graphicLayout(withPortrait, TALL, brand)
    const safe = safeArea(TALL)
    expect(box!.x).toBeCloseTo(safe.x + (safe.w / 12) * 4 + 4, 5)
  })
})

describe('reflowPortrait', () => {
  it('keeps rows and spans unchanged when the flow already fits (case 1)', () => {
    const result = reflowPortrait({
      elements: [shapeElement('s0', 0, 3), shapeElement('s1', 1, 3), shapeElement('s2', 2, 3)],
    })
    const bands = result.elements.map((element) => element.portraitCell!)
    expect(bands.map((cell) => [cell.row, cell.rowSpan])).toEqual([
      [0, 3],
      [3, 3],
      [6, 3],
    ])
  })

  it('compresses the tail under overflow, keeping earlier elements at their wanted size (case 2)', () => {
    const result = reflowPortrait({
      elements: Array.from({ length: 6 }, (_, i) => shapeElement(`s${i}`, i, 3)),
    })
    const bands = result.elements.map((element) => element.portraitCell!)
    // Six elements wanting 3 rows each cannot all have it on a 12-row grid. The first
    // three keep their full size, since the top of a scene usually carries the heading
    // and the figure; the tail compresses to one row each rather than every element
    // shrinking equally, and the total still tiles the grid exactly.
    expect(bands.map((cell) => [cell.row, cell.rowSpan])).toEqual([
      [0, 3],
      [3, 3],
      [6, 3],
      [9, 1],
      [10, 1],
      [11, 1],
    ])
    for (const band of bands) {
      expect(band.row + band.rowSpan).toBeLessThanOrEqual(12)
    }
    expect(pairwiseDisjointRows(bands)).toBe(true)
  })

  it('falls back to the whole grid when the room below a pin cannot seat every flowed element (case 3)', () => {
    const result = reflowPortrait({
      elements: [
        {
          ...shapeElement('pinned', 0, 10),
          portraitCell: { col: 0, row: 0, colSpan: 12, rowSpan: 10 },
        },
        ...Array.from({ length: 5 }, (_, i) => shapeElement(`p${i}`, i, 1)),
      ],
    })
    const flowed = result.elements
      .filter((element) => element.id !== 'pinned')
      .map((element) => element.portraitCell!)
    // Two rows are left below the pin and five elements need one row each, so the
    // ranking in the doc comment applies: the flow takes the whole grid instead of
    // squeezing below the pin, and every flowed element gets a row of its own even
    // though that means overlapping the pin, which is the author's own placement.
    expect(flowed.map((cell) => [cell.row, cell.rowSpan])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
    ])
    for (const band of flowed) {
      expect(band.row + band.rowSpan).toBeLessThanOrEqual(12)
    }
    expect(pairwiseDisjointRows(flowed)).toBe(true)
  })

  it('starts the flow below a pinned cell and never overlaps it', () => {
    const withPin: GraphicScene = {
      elements: [
        {
          kind: 'shape',
          id: 'pinned',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 6 },
          portraitCell: { col: 0, row: 0, colSpan: 12, rowSpan: 6 },
          form: 'rect',
          color: 'surface',
          opacity: 1,
          enter: { kind: 'fade', atMs: 0 },
        },
        {
          kind: 'shape',
          id: 'flowed',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          form: 'rect',
          color: 'surface',
          opacity: 1,
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
    }
    const result = reflowPortrait(withPin)
    const pinned = result.elements.find((element) => element.id === 'pinned')!.portraitCell!
    const flowed = result.elements.find((element) => element.id === 'flowed')!.portraitCell!
    expect(flowed.row).toBeGreaterThanOrEqual(pinned.row + pinned.rowSpan)
  })
})

describe('fitFontPx', () => {
  it('never exceeds the role size and shrinks a long label to its box', () => {
    expect(fitFontPx('Hi', 2000, 72)).toBe(72)
    const label = 'A label that must shrink'
    const fitted = fitFontPx(label, 300, 72)
    expect(fitted).toBeLessThan(72)
    expect(fitted).toBeGreaterThan(12)
    // The estimate: glyphs at 0.56 em must fit the width.
    expect(label.length * 0.56 * fitted).toBeLessThanOrEqual(300)
  })

  it('stops at the legibility floor rather than shrinking out of sight', () => {
    // 48 glyphs in a 300px box would fit only at 11px, so the floor wins and
    // the label overflows. Text below 12px reads as a smudge on a phone.
    expect(fitFontPx('A very long label that will not fit at full size', 300, 72)).toBe(12)
  })
})

describe('tokenColor and roleBasePx', () => {
  it('resolves every token name to a brand colour', () => {
    expect(tokenColor('accent', brand)).toBe(brand.colors.accent)
    expect(tokenColor('collapse', brand)).toBe(brand.colors.semantic.collapse)
    expect(tokenColor('series1', brand)).toBe(brand.colors.chartSeries[1])
    expect(roleBasePx('numbers')).toBe(96)
  })

  it('resolves every one of the twelve token names to a non-empty colour', () => {
    expect(GRAPHIC_COLORS).toHaveLength(12)
    for (const name of GRAPHIC_COLORS) {
      const color = tokenColor(name, brand)
      expect(typeof color).toBe('string')
      expect(color.length).toBeGreaterThan(0)
    }
  })
})

describe('enterProgress and countedValue', () => {
  it('eases from the offset over 600 ms', () => {
    expect(enterProgress(0, 30, 400)).toBe(0)
    expect(enterProgress(12, 30, 400)).toBe(0)
    expect(enterProgress(21, 30, 400)).toBeGreaterThan(0)
    expect(enterProgress(30, 30, 400)).toBe(1)
  })

  it('tweens the digits and keeps every other character in place, landing exactly', () => {
    expect(countedValue('$4bn', 0)).toBe('$0bn')
    expect(countedValue('$4bn', 1)).toBe('$4bn')
    expect(countedValue('1,200 staff', 1)).toBe('1,200 staff')
    expect(countedValue('1,200 staff', 0.5)).toMatch(/^\d{1,3},?\d* staff$/)
    expect(countedValue('94%', 0.5)).toBe('47%')
    // The decimal case the schema itself names as canonical (figureDigitGroups' own
    // doc comment), previously untested here.
    expect(countedValue('$4.5bn', 0)).toBe('$0.0bn')
    expect(countedValue('$4.5bn', 1)).toBe('$4.5bn')
  })
})

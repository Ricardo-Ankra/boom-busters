import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  GRAPHIC_COLORS,
  graphicEnterTimes,
  resolveBrandKit,
} from '@boom-busters/schemas'
import type { GraphicCell, GraphicScene } from '@boom-busters/schemas'
import {
  barLengthPx,
  barsGeometry,
  countedValue,
  enterProgress,
  estimatedTextWidth,
  FIGURE_MAX_PX,
  fitFontPx,
  glyphAdvanceEm,
  graphicDrift,
  graphicLayout,
  reflowPortrait,
  roleBasePx,
  roleFontPx,
  ruleThicknessPx,
  safeArea,
  separateOverlaps,
  staggeredEnterMs,
  tokenColor,
  underlineBar,
} from './graphic'
import type { Box } from './graphic'

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
      align: 'start',
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
    expect(f!.fontPx).toBeLessThanOrEqual(FIGURE_MAX_PX)
    expect(l!.fontPx).toBeUndefined()
  })

  describe('a figure fills its box (R1)', () => {
    const figure = (value: string, label?: string): GraphicScene => ({
      elements: [
        {
          kind: 'figure',
          align: 'start',
          id: 'big',
          cell: { col: 0, row: 2, colSpan: 8, rowSpan: 4 },
          value,
          ...(label ? { label } : {}),
          claimRef: '01HQ00000000000000000000A1',
          color: 'accent',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
    })

    it('draws a short value far above the old 96 cap, scaled with the frame', () => {
      const frame = { width: 1280, height: 720 }
      const [box] = graphicLayout(figure('$270M', 'Burned'), frame, brand)
      const oldCap = roleBasePx('numbers') * (720 / 1080)
      expect(box!.fontPx).toBeGreaterThan(oldCap * 1.5)
      expect(FIGURE_MAX_PX).toBe(300)
      expect(box!.fontPx).toBeLessThanOrEqual(FIGURE_MAX_PX * (720 / 1080))
    })

    it('still fits its box by width and by the height left after the caption', () => {
      for (const frame of [WIDE, { width: 1280, height: 720 }]) {
        for (const value of ['$270M', '$1bn', '1,250,000,000']) {
          const [box] = graphicLayout(figure(value, 'Burned'), frame, brand)
          const drawn = roleFontPx('numbers', box!.fontPx!, brand)
          const width = estimatedTextWidth(value, drawn, brand.typography.numbers)
          expect(width).toBeLessThanOrEqual(box!.w + 1)
          expect(drawn * 1.25).toBeLessThanOrEqual(box!.h)
        }
      }
    })

    it('leaves text elements under their own role cap', () => {
      const [box] = graphicLayout(scene, WIDE, brand)
      expect(box!.fontPx).toBeLessThanOrEqual(roleBasePx('heading'))
    })
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

  it('fits a bars element a label size too, closing the gap where bars carried no fontPx', () => {
    // Task 5's review: GraphicCard used to derive the bars label size itself,
    // which was harmless only because nothing else drew bars. Now the board's
    // preview does too, so both must read the SAME number off the box
    // `graphicLayout` already computed, not refit it independently.
    const withBars: GraphicScene = {
      elements: [
        {
          kind: 'bars',
          id: 'b',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 },
          color: 'collapse',
          enter: { kind: 'fade', atMs: 0 },
          items: [
            { label: 'raised', value: 4, display: '$4bn', claimRef: '01HQ00000000000000000000A1' },
            {
              label: 'burned',
              value: 3.9,
              display: '$3.9bn',
              claimRef: '01HQ00000000000000000000A2',
            },
          ],
        },
      ],
    }
    const [box] = graphicLayout(withBars, WIDE, brand)
    expect(box!.fontPx).toBeDefined()
    expect(box!.fontPx).toBe(barsGeometry(box!, 2, WIDE).labelPx)
  })
})

describe('reflowPortrait', () => {
  it('keeps rows and spans unchanged when the flow already fits (case 1)', () => {
    const result = reflowPortrait({
      elements: [shapeElement('s0', 0, 3), shapeElement('s1', 1, 3), shapeElement('s2', 2, 3)],
    })
    const bands = result.elements.map((element) => element.portraitCell!)
    // Nothing is pinned, so the nine used rows are centred in the twelve: three
    // spare rows, one above and two below (it was [0, 3, 6] before the stack centred).
    expect(bands.map((cell) => [cell.row, cell.rowSpan])).toEqual([
      [1, 3],
      [4, 3],
      [7, 3],
    ])
  })

  it('centres an all-flowing stack in the grid, whatever its size', () => {
    const rowsOf = (spans: number[]) =>
      reflowPortrait({
        elements: spans.map((span, i) => shapeElement(`s${i}`, i, span)),
      }).elements.map((element) => [element.portraitCell!.row, element.portraitCell!.rowSpan])
    expect(rowsOf([2])).toEqual([[5, 2]])
    expect(rowsOf([2, 4])).toEqual([
      [3, 2],
      [5, 4],
    ])
    // A stack that already fills the grid stays where it was.
    expect(rowsOf([6, 6])).toEqual([
      [0, 6],
      [6, 6],
    ])
  })

  it('does not centre a flow that sits below a pin', () => {
    const result = reflowPortrait({
      elements: [
        {
          ...shapeElement('pinned', 0, 2),
          portraitCell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
        },
        shapeElement('flowed', 0, 2),
      ],
    })
    expect(result.elements[1]!.portraitCell).toMatchObject({ row: 2, rowSpan: 2 })
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

  it('takes a scaled floor as a fourth argument, defaulting to the unscaled one', () => {
    // Task 4's existing calls (three arguments) keep the unscaled floor.
    const long = 'A very long label that will not fit at full size'
    expect(fitFontPx(long, 300, 72)).toBe(12)
    // The same box and text, scaled down a quarter (a caller with a
    // frame-scaled floor, ChartReveal.tsx's own
    // fitFigureSize(figures, base, 20 * scale) shape), floors at a quarter too.
    expect(fitFontPx(long, 75, 18, 3)).toBe(3)
  })
})

describe('the legibility floor scales with the frame (decision 268, Plan B)', () => {
  // Task 5's review: MIN_FONT_PX was the one size in this module never
  // multiplied by frameScale. At the board's 480 by 270 preview (scale
  // 0.25) the floor decided body, captions and every bars label, so the
  // owner approved a graphic with no visible type hierarchy and a
  // different one shipped. A cell too narrow for its content at ANY scale
  // isolates the floor itself, not the fit-to-width path above it.
  const floored: GraphicScene = {
    elements: [
      {
        kind: 'text',
        id: 't',
        cell: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        content: 'A label many times longer than one grid cell could ever fit',
        role: 'body',
        color: 'textPrimary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
      },
    ],
  }

  it('keeps a small frame proportional to 1080p rather than flattening to one size', () => {
    const wideFontPx = graphicLayout(floored, WIDE, brand)[0]!.fontPx!
    const smallFontPx = graphicLayout(floored, { width: 480, height: 270 }, brand)[0]!.fontPx!
    // At 1080p frameScale is 1, so this is the render's own unscaled floor.
    expect(wideFontPx).toBe(12)
    // frameScale(480, 270) is 0.25: the same floor, scaled, is 3, not the
    // unscaled 12 that would make body, captions and bars labels collapse
    // to roughly the same size on the small preview.
    expect(smallFontPx).toBeCloseTo(3, 5)
    expect(smallFontPx / wideFontPx).toBeCloseTo(0.25, 5)
  })

  it('scales a bars label floor the same way, not just text and figures', () => {
    const box: Box = { x: 0, y: 0, w: 400, h: 4 }
    const wideLabelPx = barsGeometry(box, 4, WIDE).labelPx
    const smallLabelPx = barsGeometry(box, 4, { width: 480, height: 270 }).labelPx
    expect(wideLabelPx).toBe(12)
    expect(smallLabelPx).toBeCloseTo(3, 5)
  })
})

describe('barsGeometry, barLengthPx and ruleThicknessPx', () => {
  it('splits the box into even rows and fits the label to the row', () => {
    const box: Box = { x: 0, y: 0, w: 400, h: 200 }
    const { rowH, labelPx } = barsGeometry(box, 4, WIDE)
    expect(rowH).toBe(50)
    // 50 * 0.32 = 16, comfortably between the 12px floor and the 28px cap.
    expect(labelPx).toBe(16)
  })

  it('floors the label at the legibility minimum for a cramped row', () => {
    const box: Box = { x: 0, y: 0, w: 400, h: 20 }
    expect(barsGeometry(box, 4, WIDE).labelPx).toBe(12)
  })

  it('caps the label at the frame-scaled maximum for a tall row', () => {
    const box: Box = { x: 0, y: 0, w: 400, h: 400 }
    expect(barsGeometry(box, 2, WIDE).labelPx).toBe(28)
  })

  it('scales the cap down on a smaller frame, same as every other role size', () => {
    const box: Box = { x: 0, y: 0, w: 400, h: 400 }
    // frameScale is 1 at 1080p in EITHER orientation (WIDE and TALL both
    // qualify), so a frame scaled below that is needed to see the cap move:
    // half of 1080 on the short side halves the 28px cap to 14.
    expect(barsGeometry(box, 2, { width: 960, height: 540 }).labelPx).toBe(14)
  })

  it('draws a bar as its value share of the box width, times the entrance grow', () => {
    expect(barLengthPx(100, 0.5)).toBe(31)
    expect(barLengthPx(100, 1, 0)).toBe(0)
    expect(barLengthPx(100, 1, 1)).toBe(62)
  })

  it('thickens the rule with the frame scale, floored at 2px', () => {
    expect(ruleThicknessPx(WIDE)).toBe(3)
    expect(ruleThicknessPx({ width: 200, height: 100 })).toBe(2)
  })
})

describe('underlineBar (R2)', () => {
  const frame = { width: 1920, height: 1080 }

  it('is 0.06 of the font size thick, floored at 3 px scaled with the frame', () => {
    expect(underlineBar(200, 500, 1, frame).thicknessPx).toBeCloseTo(12, 5)
    expect(underlineBar(20, 100, 1, frame).thicknessPx).toBe(3)
    expect(underlineBar(20, 100, 1, { width: 540, height: 960 }).thicknessPx).toBe(1.5)
  })

  it('starts 0.12 of the font size below the baseline, which sits 0.36 below the centre', () => {
    expect(underlineBar(100, 300, 1, frame).topFromCentrePx).toBeCloseTo(48, 5)
    expect(underlineBar(50, 300, 1, frame).topFromCentrePx).toBeCloseTo(24, 5)
  })

  it('sweeps from nothing to the text width, and clamps outside 0 to 1', () => {
    expect(underlineBar(100, 300, 0, frame).widthPx).toBe(0)
    expect(underlineBar(100, 300, 0.5, frame).widthPx).toBe(150)
    expect(underlineBar(100, 300, 1, frame).widthPx).toBe(300)
    expect(underlineBar(100, 300, 1.4, frame).widthPx).toBe(300)
    expect(underlineBar(100, 300, -1, frame).widthPx).toBe(0)
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

describe('separateOverlaps: landscape collisions', () => {
  const text = (id: string, cell: GraphicCell): GraphicScene['elements'][number] => ({
    kind: 'text',
    id,
    cell,
    content: id,
    role: 'body',
    color: 'textPrimary',
    align: 'start',
    enter: { kind: 'fade', atMs: 0 },
  })

  it('leaves a scene whose elements already sit clear of one another untouched', () => {
    const clear: GraphicScene = {
      elements: [
        text('a', { col: 0, row: 0, colSpan: 6, rowSpan: 2 }),
        text('b', { col: 0, row: 3, colSpan: 6, rowSpan: 2 }),
      ],
    }
    expect(separateOverlaps(clear)).toEqual(clear)
  })

  it('slides a colliding element down to the first clear row, keeping its column', () => {
    const clash: GraphicScene = {
      elements: [
        text('a', { col: 2, row: 4, colSpan: 6, rowSpan: 3 }),
        text('b', { col: 2, row: 5, colSpan: 6, rowSpan: 2 }),
      ],
    }
    const [first, second] = separateOverlaps(clash).elements
    expect(first!.cell).toEqual({ col: 2, row: 4, colSpan: 6, rowSpan: 3 })
    // Row 7 is the first clear row BELOW the one it asked for. Going up to
    // row 0 would also be clear, and would put it above the element it
    // collided with, which reverses the card's reading order.
    expect(second!.cell).toEqual({ col: 2, row: 7, colSpan: 6, rowSpan: 2 })
  })

  it('goes up only when nothing below the planned row is clear', () => {
    const bottomHeavy: GraphicScene = {
      elements: [
        text('a', { col: 0, row: 6, colSpan: 6, rowSpan: 6 }),
        text('b', { col: 0, row: 8, colSpan: 6, rowSpan: 3 }),
      ],
    }
    const [, second] = separateOverlaps(bottomHeavy).elements
    // Rows 8 and 9 collide and there is no room below, so it takes the
    // nearest clear row above rather than staying on top of its neighbour.
    expect(second!.cell).toEqual({ col: 0, row: 3, colSpan: 6, rowSpan: 3 })
  })

  it('leaves elements in different columns alone, however their rows overlap', () => {
    const side: GraphicScene = {
      elements: [
        text('a', { col: 0, row: 0, colSpan: 5, rowSpan: 6 }),
        text('b', { col: 6, row: 0, colSpan: 5, rowSpan: 6 }),
      ],
    }
    expect(separateOverlaps(side)).toEqual(side)
  })

  // A panel behind a figure is the commonest composed card there is; moving
  // anything off it would break the design the planner asked for.
  it('never moves a shape, and never lets one push another element away', () => {
    const panelled: GraphicScene = {
      elements: [
        {
          kind: 'shape',
          id: 'panel',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 6 },
          form: 'rect',
          color: 'surface',
          opacity: 0.4,
          enter: { kind: 'fade', atMs: 0 },
        },
        text('a', { col: 1, row: 1, colSpan: 6, rowSpan: 2 }),
      ],
    }
    expect(separateOverlaps(panelled)).toEqual(panelled)
  })

  it('keeps the planned cell when nothing on the grid is clear, rather than losing it', () => {
    const full: GraphicScene = {
      elements: [
        text('a', { col: 0, row: 0, colSpan: 12, rowSpan: 12 }),
        text('b', { col: 0, row: 3, colSpan: 12, rowSpan: 4 }),
      ],
    }
    const [, second] = separateOverlaps(full).elements
    expect(second!.cell).toEqual({ col: 0, row: 3, colSpan: 12, rowSpan: 4 })
  })

  it('is what landscape layout runs, so overlapping cells get different boxes', () => {
    const clash: GraphicScene = {
      elements: [
        text('a', { col: 0, row: 4, colSpan: 6, rowSpan: 3 }),
        text('b', { col: 0, row: 5, colSpan: 6, rowSpan: 2 }),
      ],
    }
    const [a, b] = graphicLayout(clash, WIDE, brand)
    expect(a!.y).not.toBe(b!.y)
  })
})

describe('staggeredEnterMs', () => {
  const at = (id: string, atMs: number): GraphicScene['elements'][number] => ({
    kind: 'text',
    id,
    cell: { col: 0, row: 0, colSpan: 4, rowSpan: 1 },
    content: id,
    role: 'body',
    color: 'textPrimary',
    align: 'start',
    enter: { kind: 'fade', atMs },
  })

  it('spreads entrances in scene order when nothing in the scene asks for a time', () => {
    const times = staggeredEnterMs({ elements: [at('a', 0), at('b', 0), at('c', 0)] })
    expect([times.get('a'), times.get('b'), times.get('c')]).toEqual([0, 180, 360])
  })

  // The planner timed the card; every offset is then a choice, zeroes included.
  it('leaves every offset exactly as written once any element carries a time', () => {
    const times = staggeredEnterMs({ elements: [at('a', 0), at('b', 900)] })
    expect([times.get('a'), times.get('b')]).toEqual([0, 900])
  })

  it('times entrances by the shared rule the designer is checked against (decision 289)', () => {
    const scene = { elements: [at('a', 0), at('b', 0), at('c', 700)] }
    expect(staggeredEnterMs(scene)).toEqual(graphicEnterTimes(scene))
  })
})

describe('graphicDrift', () => {
  it('starts at rest and lifts by the full amount at the end of the slot', () => {
    expect(graphicDrift(0, 180)).toBe(1)
    expect(graphicDrift(179, 180)).toBeCloseTo(1.012)
  })

  it('never goes backwards across the slot', () => {
    let last = graphicDrift(0, 180)
    for (let frame = 1; frame < 180; frame += 1) {
      const next = graphicDrift(frame, 180)
      expect(next).toBeGreaterThanOrEqual(last)
      last = next
    }
  })

  it('is a no-op on a degenerate one-frame slot', () => {
    expect(graphicDrift(0, 1)).toBe(1)
  })
})

// Decision 283: the fit is made at the size the brand kit DRAWS text at.
describe('text is fitted at its drawn size', () => {
  // The production card: two headings side by side, the brand kit's heading
  // scaled 1.4. Fitted unscaled, both drew 40 per cent wider than their boxes
  // and clipped mid-word against each other ("Funding rais", "Reported valuat").
  const brandKit = resolveBrandKit(DEFAULT_SETTINGS)
  const scaled = {
    ...brandKit,
    typography: {
      ...brandKit.typography,
      heading: {
        family: 'Inter',
        weight: 700,
        sizeScale: 1.4,
        letterSpacing: 0,
        transform: 'none' as const,
      },
    },
  }
  const heading = (id: string, col: number, colSpan: number, content: string) => ({
    kind: 'text' as const,
    id,
    cell: { col, row: 3, colSpan, rowSpan: 2 },
    content,
    role: 'heading' as const,
    color: 'textSecondary' as const,
    align: 'start' as const,
    enter: { kind: 'fade' as const, atMs: 0 },
  })
  const figure = (id: string, col: number, colSpan: number, value: string) => ({
    kind: 'figure' as const,
    align: 'start' as const,
    id,
    cell: { col, row: 5, colSpan, rowSpan: 3 },
    value,
    claimRef: '01HQ00000000000000000000A1',
    color: 'textPrimary' as const,
    enter: { kind: 'rise' as const, atMs: 500 },
  })
  const card: GraphicScene = {
    elements: [
      heading('raise-title', 2, 4, 'Funding raised'),
      figure('raise-fig', 2, 4, '$101m'),
      heading('val-title', 6, 5, 'Reported valuation'),
      figure('val-fig', 6, 5, '$1bn'),
    ],
  }

  it('keeps each heading inside its own box once the brand scale is applied', () => {
    const boxes = graphicLayout(card, WIDE, scaled)
    for (const id of ['raise-title', 'val-title']) {
      const box = boxes.find((candidate) => candidate.id === id)!
      const element = card.elements.find((candidate) => candidate.id === id)!
      const drawn = roleFontPx('heading', box.fontPx!, scaled)
      const content = element.kind === 'text' ? element.content : ''
      expect(estimatedTextWidth(content, drawn, scaled.typography.heading)).toBeLessThanOrEqual(
        box.w,
      )
    }
  })

  it('draws a short heading at its full scaled size, not smaller', () => {
    const roomy = {
      ...heading('t', 0, 12, 'Raised'),
      cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 },
    }
    const [box] = graphicLayout({ elements: [roomy] }, WIDE, scaled)
    expect(roleFontPx('heading', box!.fontPx!, scaled)).toBe(
      Math.round(roleBasePx('heading') * 1.4),
    )
  })

  it('reads a monospaced figure at its true 0.6 em advance', () => {
    const long = figure('f', 0, 3, '$1,234,567,890')
    const [box] = graphicLayout({ elements: [long] }, WIDE, brandKit)
    const drawn = roleFontPx('numbers', box!.fontPx!, brandKit)
    expect(brandKit.typography.numbers.family).toBe('JetBrains Mono')
    expect(long.value.length * 0.6 * drawn).toBeLessThanOrEqual(box!.w)
  })

  it('narrows for capitals and tracking the brand kit asks for', () => {
    const plain = brandKit.typography.heading
    const loud = { ...plain, transform: 'uppercase' as const, letterSpacing: 0.08 }
    expect(glyphAdvanceEm(loud)).toBeGreaterThan(glyphAdvanceEm(plain) + 0.08)
    const plainPx = fitFontPx('Reported valuation', 600, 72, 12, { type: plain })
    const loudPx = fitFontPx('Reported valuation', 600, 72, 12, { type: loud })
    expect(loudPx).toBeLessThan(plainPx)
  })

  it('keeps a scaled heading inside its box height too', () => {
    const tall = {
      ...scaled,
      typography: { ...scaled.typography, heading: { ...scaled.typography.heading, sizeScale: 3 } },
    }
    const [box] = graphicLayout(
      {
        elements: [
          { ...heading('t', 0, 12, 'Hi'), cell: { col: 0, row: 0, colSpan: 12, rowSpan: 1 } },
        ],
      },
      WIDE,
      tall,
    )
    expect(roleFontPx('heading', box!.fontPx!, tall) * 1.25).toBeLessThanOrEqual(box!.h + 1)
  })

  it('holds the legibility floor at the drawn size, whatever the scale', () => {
    const tiny = { ...brandKit.typography.body, sizeScale: 2 }
    const px = fitFontPx('A label many times longer than its box could ever hold', 60, 32, 12, {
      type: tiny,
    })
    expect(px * tiny.sizeScale).toBe(12)
  })
})

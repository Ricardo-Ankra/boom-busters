import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_COLORS,
  GraphicSceneSchema,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  figureCitesClaim,
  figureDigitGroups,
} from './graphics'

const CLAIM = '01HQ00000000000000000000AA'

const cell = (col: number, row: number, colSpan = 4, rowSpan = 2) => ({
  col,
  row,
  colSpan,
  rowSpan,
})

const text = (id: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'text',
  id,
  cell: cell(0, 0),
  content: 'Raised in one round',
  role: 'heading',
  color: 'textPrimary',
  ...overrides,
})

const figure = (id: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'figure',
  id,
  cell: cell(0, 2, 6, 3),
  value: '$4bn',
  label: 'valuation',
  claimRef: CLAIM,
  color: 'accent',
  enter: { kind: 'count', atMs: 400 },
  ...overrides,
})

describe('GraphicSceneSchema', () => {
  it('accepts a scene of named tokens on the grid', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [
        text('t1'),
        figure('f1'),
        { kind: 'logo', id: 'l1', cell: cell(8, 0, 4, 3), entity: 'Stability AI' },
        { kind: 'shape', id: 's1', cell: cell(0, 5, 12, 1), form: 'rule', color: 'textSecondary' },
      ],
    })
    expect(parsed.elements).toHaveLength(4)
    // Defaults land: a plain fade at the slot's start, full opacity, start alignment.
    expect(parsed.elements[0]).toMatchObject({ enter: { kind: 'fade', atMs: 0 }, align: 'start' })
    expect(parsed.elements[3]).toMatchObject({ opacity: 1 })
  })

  it('refuses a hex colour, a seventh element, a cell off the grid and an unknown role', () => {
    expect(
      GraphicSceneSchema.safeParse({ elements: [text('t1', { color: '#ff0000' })] }).success,
    ).toBe(false)
    expect(
      GraphicSceneSchema.safeParse({ elements: [text('t1', { role: 'display' })] }).success,
    ).toBe(false)
    expect(
      GraphicSceneSchema.safeParse({ elements: [text('t1', { cell: cell(9, 0, 4, 2) })] }).success,
    ).toBe(false)
    const seven = Array.from({ length: MAX_GRAPHIC_ELEMENTS + 1 }, (_, i) => text(`t${i}`))
    expect(GraphicSceneSchema.safeParse({ elements: seven }).success).toBe(false)
  })

  it('lets only a figure count, keeps ids unique, and names an entity once', () => {
    expect(
      GraphicSceneSchema.safeParse({
        elements: [text('t1', { enter: { kind: 'count', atMs: 0 } })],
      }).success,
    ).toBe(false)
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1'), text('t1')] }).success).toBe(false)
    expect(
      GraphicSceneSchema.safeParse({
        elements: [
          { kind: 'logo', id: 'l1', cell: cell(0, 0), entity: 'Stability AI' },
          { kind: 'logo', id: 'l2', cell: cell(4, 0), entity: 'stability ai' },
        ],
      }).success,
    ).toBe(false)
  })

  it('requires two to five cited bars', () => {
    const bar = (label: string, value: number) => ({
      label,
      value,
      display: `${value}`,
      claimRef: CLAIM,
    })
    const bars = (items: unknown[]) => ({
      kind: 'bars',
      id: 'b1',
      cell: cell(0, 0, 12, 4),
      items,
      color: 'accent',
    })
    expect(GraphicSceneSchema.safeParse({ elements: [bars([bar('a', 1)])] }).success).toBe(false)
    expect(
      GraphicSceneSchema.safeParse({ elements: [bars([bar('a', 1), bar('b', 2)])] }).success,
    ).toBe(true)
    expect(
      GraphicSceneSchema.safeParse({
        elements: [bars([1, 2, 3, 4, 5, 6].map((n) => bar(`x${n}`, n)))],
      }).success,
    ).toBe(false)
  })

  it('exposes the colour names a scene may use, and only those', () => {
    expect(GRAPHIC_COLORS).toEqual([
      'primary',
      'accent',
      'background',
      'surface',
      'textPrimary',
      'textSecondary',
      'captionHighlight',
      'collapse',
      'recovery',
      'series0',
      'series1',
      'series2',
    ])
  })
})

describe('PlannedGraphicSceneSchema', () => {
  it('takes claim numbers and entities, never ids', () => {
    const parsed = PlannedGraphicSceneSchema.parse({
      elements: [
        figure('f1', { claimRef: 3 }),
        { kind: 'logo', id: 'l1', cell: cell(8, 0, 4, 3), entity: 'Wirecard AG' },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({ claimRef: 3 })
    expect(
      PlannedGraphicSceneSchema.safeParse({ elements: [figure('f1', { claimRef: CLAIM })] })
        .success,
    ).toBe(false)
    expect(
      PlannedGraphicSceneSchema.safeParse({ elements: [figure('f1', { claimRef: 0 })] }).success,
    ).toBe(false)
  })
})

describe('figureCitesClaim', () => {
  it('finds every digit group of the shown value in the claim, ignoring separators and scale words', () => {
    expect(figureCitesClaim('$4bn', 'The company raised $4 billion in 2022.')).toBe(true)
    expect(figureCitesClaim('4,000', 'About 4000 staff were let go.')).toBe(true)
    expect(figureCitesClaim('94%', 'Some 94 percent of deposits left in a week.')).toBe(true)
    expect(figureCitesClaim('$1.9bn', 'Auditors could not find $1.9 billion.')).toBe(true)
    expect(figureCitesClaim('EUR 1,900,000,000', 'the missing 1.9 billion euros')).toBe(false)
  })

  it('refuses a value the claim does not carry, and a value with no digits', () => {
    expect(figureCitesClaim('$4.5bn', 'The company raised $4 billion.')).toBe(false)
    expect(figureCitesClaim('2019', 'in late twenty-nineteen')).toBe(false)
    expect(figureCitesClaim('none', 'nothing here')).toBe(false)
  })

  it('exposes the digit groups it compares', () => {
    expect(figureDigitGroups('$4.5bn')).toEqual(['4.5'])
    expect(figureDigitGroups('1,200 staff, 3 sites')).toEqual(['1200', '3'])
  })
})

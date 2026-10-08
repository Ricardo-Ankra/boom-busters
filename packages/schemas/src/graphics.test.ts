import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_COLORS,
  GRAPHIC_MAX_ENTER_MS,
  GraphicSceneSchema,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  figureCitesClaim,
  figureDigitGroups,
  barItemTimes,
  emphasisWindow,
  graphicEnterTimes,
  graphicOnScreen,
  intervalsMeet,
  lateEntranceIssue,
  maxOnScreen,
  graphicChangeTimes,
  graphicExitTimes,
  longestStill,
  sceneTimingIssue,
} from './graphics'
import type { GraphicTimingElement, GraphicTimingScene } from './graphics'

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

  it('aligns a figure like a text: start by default, and centre or end when asked', () => {
    const alignOf = (element: { kind: string; align?: string }) =>
      element.kind === 'figure' ? element.align : null
    const parsed = GraphicSceneSchema.parse({
      elements: [figure('f1'), figure('f2', { align: 'center' }), figure('f3', { align: 'end' })],
    })
    expect(parsed.elements.map(alignOf)).toEqual(['start', 'center', 'end'])
    expect(
      GraphicSceneSchema.safeParse({ elements: [figure('f1', { align: 'middle' })] }).success,
    ).toBe(false)
    const planned = PlannedGraphicSceneSchema.parse({
      elements: [figure('f1', { claimRef: 1 }), figure('f2', { claimRef: 1, align: 'center' })],
    })
    expect(planned.elements.map(alignOf)).toEqual(['start', 'center'])
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

describe('entrance timing (decision 289)', () => {
  const el = (id: string, atMs: number) => ({ id, enter: { atMs } })

  it('staggers unauthored entrances 180 ms apart', () => {
    const times = graphicEnterTimes({ elements: [el('a', 0), el('b', 0), el('c', 0)] })
    expect([...times.values()]).toEqual([0, 180, 360])
  })

  it('parses an entrance up to the cap and refuses one past it', () => {
    const at = (atMs: number) =>
      GraphicSceneSchema.safeParse({
        elements: [text('t1', { enter: { kind: 'fade', atMs } })],
      })
    expect(GRAPHIC_MAX_ENTER_MS).toBe(60_000)
    expect(at(15000).success).toBe(true)
    expect(at(GRAPHIC_MAX_ENTER_MS).success).toBe(true)
    expect(at(60001).success).toBe(false)
  })

  it('uses authored times as written once any element is timed', () => {
    const times = graphicEnterTimes({ elements: [el('a', 0), el('b', 900)] })
    expect([...times.values()]).toEqual([0, 900])
  })

  it('accepts entrances that finish inside the slot', () => {
    expect(lateEntranceIssue({ elements: [el('a', 0), el('b', 2400)] }, 3000)).toBeNull()
  })

  it('names the first entrance that cannot finish before the slot ends', () => {
    expect(lateEntranceIssue({ elements: [el('a', 0), el('b', 2500)] }, 3000)).toBe(
      'element "b" enters at 2500 ms, but this 3.0 s slot needs every entrance to start by 2400 ms',
    )
  })

  it('applies to staggered entrances too', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => el(id, 0))
    // Sixth element enters at 900 ms; a 1.4 s slot needs starts by 800 ms.
    expect(lateEntranceIssue({ elements: six }, 1400)).toMatch(/^element "f" enters at 900 ms/)
  })
})

describe('motion vocabulary (decision 290)', () => {
  const issues = (scene: Record<string, unknown>) => {
    const result = GraphicSceneSchema.safeParse(scene)
    return result.success ? [] : result.error.issues.map((issue) => issue.message)
  }

  it('parses a stage 1 scene as before: no exit, no camera, the word-form emphasis', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [text('t1'), figure('f1', { emphasis: 'underline' })],
    })
    expect(parsed.camera).toBeUndefined()
    expect(parsed.elements[0]).not.toHaveProperty('exit')
    expect(parsed.elements[1]).toMatchObject({ emphasis: 'underline' })
  })

  it('parses an exit, a timed emphasis, a timed bar and a camera track', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [
        text('t1', { exit: { kind: 'drop', atMs: 4000 } }),
        figure('f1', { emphasis: { kind: 'color', atMs: 5000, to: 'collapse' } }),
        {
          kind: 'bars',
          id: 'b1',
          cell: cell(0, 6, 12, 4),
          color: 'series0',
          items: [
            { label: 'then', value: 1, display: '$1bn', claimRef: CLAIM },
            { label: 'later', value: 4, display: '$4bn', claimRef: CLAIM, atMs: 6000 },
          ],
        },
      ],
      camera: [
        { atMs: 7000, focus: 'b1', zoom: 1.3 },
        { atMs: 9000, focus: 'all' },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({ exit: { kind: 'drop', atMs: 4000 } })
    expect(parsed.elements[1]).toMatchObject({
      emphasis: { kind: 'color', atMs: 5000, to: 'collapse' },
    })
    expect(parsed.camera).toEqual([
      { atMs: 7000, focus: 'b1', zoom: 1.3 },
      { atMs: 9000, focus: 'all', zoom: 1 },
    ])
  })

  it('allows ten elements in all when no more than six are on screen at once', () => {
    const first = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      text(id, { cell: cell(0, i * 2, 12, 2), exit: { kind: 'fade', atMs: 5000 } }),
    )
    const second = ['f', 'g', 'h', 'i', 'j'].map((id, i) =>
      text(id, { cell: cell(0, i * 2, 12, 2), enter: { kind: 'fade', atMs: 5000 } }),
    )
    expect(issues({ elements: [...first, ...second] })).toEqual([])
  })

  it('refuses a seventh element on screen at once, saying when, and an eleventh in all', () => {
    const seven = Array.from({ length: 7 }, (_, i) => text(`t${i}`))
    // Untimed, they stagger 180 ms apart: the seventh arrives at 1080 ms.
    expect(issues({ elements: seven })).toContain(
      '7 elements are on screen together at 1080 ms; at most 6 may be',
    )
    const eleven = Array.from({ length: 11 }, (_, i) =>
      text(`t${i}`, {
        enter: { kind: 'fade', atMs: 1000 * i },
        exit: { kind: 'fade', atMs: 1000 * i + 900 },
      }),
    )
    expect(GraphicSceneSchema.safeParse({ elements: eleven }).success).toBe(false)
  })

  it('keeps a colour emphasis to colour and off logos, and a timed underline to text and figures', () => {
    const logo = { kind: 'logo', id: 'l1', cell: cell(0, 0), entity: 'Stability AI' }
    const rule = { kind: 'shape', id: 's1', cell: cell(0, 5, 12, 1), form: 'rule', color: 'accent' }
    expect(
      issues({ elements: [figure('f1', { emphasis: { kind: 'color', atMs: 2000 } })] }),
    ).toContain('a colour emphasis names the colour it shifts "to"')
    expect(
      issues({
        elements: [figure('f1', { emphasis: { kind: 'pulse', atMs: 2000, to: 'accent' } })],
      }),
    ).toContain('"to" belongs only to a colour emphasis')
    expect(
      issues({ elements: [{ ...logo, emphasis: { kind: 'color', atMs: 2000, to: 'accent' } }] }),
    ).toContain('a logo is never recoloured')
    expect(
      issues({ elements: [{ ...rule, emphasis: { kind: 'underline', atMs: 2000 } }] }),
    ).toContain('only a text or a figure can be underlined')
    // The word form is not newly restricted, so no stored scene starts failing.
    expect(issues({ elements: [{ ...rule, emphasis: 'underline' }] })).toEqual([])
    expect(
      issues({
        elements: [figure('f1', { emphasis: { kind: 'color', atMs: 2000, to: 'collapse' } })],
      }),
    ).toEqual([])
  })

  it('refuses a camera key on no element, a zoom past 1.6 and a fifth key', () => {
    expect(issues({ elements: [text('t1')], camera: [{ atMs: 1000, focus: 'ghost' }] })).toContain(
      'camera key 1 focuses "ghost", which is not an element of this graphic',
    )
    expect(
      GraphicSceneSchema.safeParse({
        elements: [text('t1')],
        camera: [{ atMs: 1000, focus: 't1', zoom: 1.7 }],
      }).success,
    ).toBe(false)
    const five = [1000, 3000, 5000, 7000, 9000].map((atMs) => ({ atMs, focus: 'all' }))
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1')], camera: five }).success).toBe(
      false,
    )
  })

  it('gives the planned scene the same vocabulary', () => {
    const parsed = PlannedGraphicSceneSchema.parse({
      elements: [figure('f1', { claimRef: 2, exit: { kind: 'wipe', atMs: 3000 } })],
      camera: [{ atMs: 1000, focus: 'f1', zoom: 1.2 }],
    })
    expect(parsed.elements[0]).toMatchObject({ exit: { kind: 'wipe', atMs: 3000 } })
    expect(parsed.camera).toEqual([{ atMs: 1000, focus: 'f1', zoom: 1.2 }])
  })
})

describe('time on screen (decision 290)', () => {
  const el = (id: string, atMs: number, exitAt?: number) => ({
    id,
    enter: { atMs },
    ...(exitAt === undefined ? {} : { exit: { atMs: exitAt } }),
  })

  it('runs from the entrance start to the exit start, open-ended without an exit', () => {
    const spans = graphicOnScreen({ elements: [el('a', 0, 4000), el('b', 4000)] })
    expect(spans.get('a')).toEqual({ fromMs: 0, toMs: 4000 })
    expect(spans.get('b')).toEqual({ fromMs: 4000, toMs: Number.POSITIVE_INFINITY })
    // One leaving as the other arrives is a cross-fade, not two on screen together.
    expect(intervalsMeet(spans.get('a')!, spans.get('b')!)).toBe(false)
  })

  it('counts the most on screen at once, at the first moment it happens', () => {
    expect(maxOnScreen({ elements: [el('a', 0, 4000), el('b', 1000), el('c', 4000)] })).toEqual({
      count: 2,
      atMs: 1000,
    })
  })

  it('times the word-form emphasis as stage 1 did, and the timed form at its own time', () => {
    expect(emphasisWindow('pulse', 1000)).toEqual({ kind: 'pulse', atMs: 1600, durationMs: 360 })
    expect(emphasisWindow('underline', 1000)).toEqual({
      kind: 'underline',
      atMs: 1500,
      durationMs: 600,
    })
    expect(emphasisWindow({ kind: 'color', atMs: 5000, to: 'accent' }, 1000)).toEqual({
      kind: 'color',
      atMs: 5000,
      durationMs: 400,
      to: 'accent',
    })
    expect(emphasisWindow(undefined, 1000)).toBeNull()
  })

  it('grows an untimed bar with its element, and a timed one at its own time', () => {
    expect(
      barItemTimes({ id: 'b', enter: { atMs: 2000 }, items: [{}, { atMs: 9000 }] }, 2000),
    ).toEqual([2000, 9000])
  })
})

describe('sceneTimingIssue (decision 290)', () => {
  const at = (
    id: string,
    atMs: number,
    extra: Partial<GraphicTimingElement> = {},
  ): GraphicTimingElement => ({ id, kind: 'text', enter: { atMs }, ...extra })
  const SLOT = 10_000

  it('passes a stage 1 scene and a well-timed staged one', () => {
    expect(sceneTimingIssue({ elements: [at('a', 0), at('b', 900)] }, SLOT)).toBeNull()
    expect(
      sceneTimingIssue(
        {
          elements: [
            at('a', 0, { exit: { atMs: 4000 } }),
            at('b', 4000),
            at('f', 900, { kind: 'figure', emphasis: { kind: 'color', atMs: 6000, to: 'accent' } }),
          ],
          camera: [
            { atMs: 5000, focus: 'f' },
            { atMs: 7000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBeNull()
  })

  it('rule 1: keeps the stage 1 late-entrance refusal, word for word', () => {
    expect(sceneTimingIssue({ elements: [at('a', 0), at('b', 9500)] }, SLOT)).toBe(
      'element "b" enters at 9500 ms, but this 10.0 s slot needs every entrance to start by 9400 ms',
    )
  })

  it('rule 2: an exit waits for its entrance and its emphasis, and finishes inside the slot', () => {
    expect(
      sceneTimingIssue({ elements: [at('a', 0, { exit: { atMs: 500 } }), at('b', 100)] }, SLOT),
    ).toBe('element "a" leaves at 500 ms, before its entrance and emphasis finish at 600 ms')
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { emphasis: 'pulse', exit: { atMs: 800 } }), at('b', 100)] },
        SLOT,
      ),
    ).toBe('element "a" leaves at 800 ms, before its entrance and emphasis finish at 960 ms')
    expect(
      sceneTimingIssue({ elements: [at('a', 0, { exit: { atMs: 9600 } }), at('b', 100)] }, SLOT),
    ).toBe('element "a" leaves at 9600 ms, but this 10.0 s slot needs its exit to start by 9500 ms')
  })

  it('rule 3: a timed emphasis plays while its element is fully on screen', () => {
    expect(
      sceneTimingIssue(
        { elements: [at('a', 1000, { emphasis: { kind: 'pulse', atMs: 1200 } })] },
        SLOT,
      ),
    ).toBe('element "a" is emphasised at 1200 ms, before its entrance finishes at 1600 ms')
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { emphasis: { kind: 'color', atMs: 9800, to: 'accent' } })] },
        SLOT,
      ),
    ).toBe(
      'element "a" is emphasised at 9800 ms, but this 10.0 s slot ends before its color emphasis finishes at 10200 ms',
    )
  })

  it('rule 4: each bar grows while its element is on screen, and one grows at the entrance', () => {
    const bars = (items: { atMs?: number }[], extra: Partial<GraphicTimingElement> = {}) =>
      at('b', 1000, { kind: 'bars', items, ...extra })
    expect(sceneTimingIssue({ elements: [bars([{}, { atMs: 500 }])] }, SLOT)).toBe(
      'bar 2 of "b" grows at 500 ms, before its element enters at 1000 ms',
    )
    expect(sceneTimingIssue({ elements: [bars([{}, { atMs: 9500 }])] }, SLOT)).toBe(
      'bar 2 of "b" grows at 9500 ms, but must finish growing by 10000 ms, when the slot ends',
    )
    expect(
      sceneTimingIssue(
        { elements: [bars([{}, { atMs: 3000 }], { exit: { atMs: 3500 } }), at('t', 0)] },
        SLOT,
      ),
    ).toBe(
      'bar 2 of "b" grows at 3000 ms, but must finish growing by 3500 ms, when its element starts to leave',
    )
    expect(sceneTimingIssue({ elements: [bars([{ atMs: 2000 }, { atMs: 3000 }])] }, SLOT)).toBe(
      'element "b" would enter empty: at least one bar must grow at its entrance, 1000 ms',
    )
  })

  it('rule 5: camera keys run in order, finish inside the slot, and rest on an element on screen', () => {
    const f = at('f', 0, { kind: 'figure' })
    expect(
      sceneTimingIssue(
        {
          elements: [f],
          camera: [
            { atMs: 2000, focus: 'f' },
            { atMs: 3000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBe('camera key 2 at 3000 ms must start at least 1500 ms after camera key 1 at 2000 ms')
    expect(sceneTimingIssue({ elements: [f], camera: [{ atMs: 9000, focus: 'f' }] }, SLOT)).toBe(
      'camera key 1 at 9000 ms cannot finish its move in this 10.0 s slot; it must start by 8500 ms',
    )
    expect(
      sceneTimingIssue(
        { elements: [f, at('g', 4000)], camera: [{ atMs: 2000, focus: 'g' }] },
        SLOT,
      ),
    ).toBe('camera key 1 focuses "g" at 2000 ms, before it enters at 4000 ms')
    const leaving = at('g', 100, { exit: { atMs: 5000 } })
    expect(
      sceneTimingIssue({ elements: [f, leaving], camera: [{ atMs: 2000, focus: 'g' }] }, SLOT),
    ).toBe('camera key 1 rests on "g" until 10000 ms, but it starts to leave at 5000 ms')
    expect(
      sceneTimingIssue(
        {
          elements: [f, leaving],
          camera: [
            { atMs: 2000, focus: 'g' },
            { atMs: 4000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBeNull()
    expect(
      sceneTimingIssue({ elements: [f], camera: [{ atMs: 2000, focus: 'ghost' }] }, SLOT),
    ).toBe('camera key 1 focuses "ghost", which is not an element of this graphic')
  })

  it('rule 6: no more than six on screen at once', () => {
    const seven = Array.from({ length: 7 }, (_, i) => at(`e${i}`, i * 100))
    expect(sceneTimingIssue({ elements: seven }, SLOT)).toBe(
      '7 elements are on screen together at 600 ms; at most 6 may be',
    )
  })

  it('rule 7: a graphic that steps never ends on an empty frame; one that never steps is not held to it', () => {
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { exit: { atMs: 3000 } }), at('s', 100, { kind: 'shape' })] },
        SLOT,
      ),
    ).toBe(
      'every element leaves before the end; at least one that is not a shape must stay on screen until the slot ends',
    )
    expect(sceneTimingIssue({ elements: [at('s', 0, { kind: 'shape' })] }, SLOT)).toBeNull()
  })
})

describe('change, stillness and steps (decision 290)', () => {
  // The 22.3 s valuation slot of the live runs, built in steps.
  const staged: GraphicTimingScene = {
    elements: [
      { id: 't', enter: { atMs: 2300 }, exit: { atMs: 13700 } },
      {
        id: 'b',
        kind: 'bars',
        enter: { atMs: 2300 },
        items: [{}, { atMs: 10900 }],
        emphasis: { kind: 'color', atMs: 14200, to: 'accent' },
      },
      { id: 'x', enter: { atMs: 14200 } },
    ],
    camera: [{ atMs: 14200, focus: 'b', zoom: 1.15 }],
  }

  it('finds the dead air after the last entrance of a stage 1 graphic', () => {
    // As the live run drew it: title at 2.3 s, bars at 10.9 s, then nothing for 10.8 s.
    expect(
      longestStill(
        {
          elements: [
            { id: 't', enter: { atMs: 2300 } },
            { id: 'b', enter: { atMs: 10900 } },
          ],
        },
        22300,
      ),
    ).toEqual({ fromMs: 11500, toMs: 22300 })
  })

  it('counts exits, timed bars, emphasis and camera moves as change', () => {
    expect(graphicChangeTimes(staged)).toEqual([2300, 10900, 13700, 14200])
    // Moving until 2.9 s, then still until the second bar at 10.9 s.
    expect(longestStill(staged, 22300)).toEqual({ fromMs: 2900, toMs: 10900 })
  })

  it('counts a camera key as change only when it moves the camera', () => {
    const one = { id: 'f', enter: { atMs: 0 } }
    expect(graphicChangeTimes({ elements: [one], camera: [{ atMs: 3000, focus: 'all' }] })).toEqual(
      [0],
    )
    expect(
      graphicChangeTimes({ elements: [one], camera: [{ atMs: 3000, focus: 'f', zoom: 1 }] }),
    ).toEqual([0])
    expect(
      graphicChangeTimes({
        elements: [one],
        camera: [
          { atMs: 3000, focus: 'f', zoom: 1.2 },
          { atMs: 6000, focus: 'all' },
        ],
      }),
    ).toEqual([0, 3000, 6000])
  })

  it('is empty when something moves to the very end', () => {
    expect(longestStill({ elements: [{ id: 'a', enter: { atMs: 0 } }] }, 600)).toEqual({
      fromMs: 600,
      toMs: 600,
    })
  })

  it('lists each distinct moment something starts to leave, in order', () => {
    const at = (id: string, enter: number, exit?: number) => ({
      id,
      enter: { atMs: enter },
      ...(exit === undefined ? {} : { exit: { atMs: exit } }),
    })
    expect(
      graphicExitTimes({
        elements: [at('a', 0, 4000), at('b', 100, 4000), at('c', 200, 2000), at('d', 300)],
      }),
    ).toEqual([2000, 4000])
  })
})

import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_CODE_VERSION,
  GRAPHIC_FACTS_MAX,
  GRAPHIC_SOURCE_MAX,
  GRAPHIC_TITLE_MAX,
  GraphicCodeSchema,
  PIECE_BREAK,
  PlannedGraphicCodeSchema,
  figureReading,
  graphicFactsIssue,
  passedOnTheWay,
  shownDigitGroups,
  shownFigures,
} from './graphic-code'
import { GRAPHIC_STILL_MAX_MS } from './graphic-timing'

const CLAIM = '01HQ00000000000000000000AA'

const SOURCE = "function Graphic(props) { return React.createElement('div', null, '$4bn') }"

const DESIGN = {
  version: GRAPHIC_CODE_VERSION,
  source: SOURCE,
  compiled: SOURCE,
  title: 'Four billion, on paper',
  facts: [{ text: '$4bn', claimId: CLAIM }],
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion.', atMs: 380 },
  ],
  durationMs: 6000,
}

describe('GraphicCodeSchema (decision 295)', () => {
  it('accepts a whole design', () => {
    expect(GraphicCodeSchema.parse(DESIGN)).toEqual(DESIGN)
  })

  it("may carry the critic's report and the mechanisms it named (spec 2026-11-04, section 10.4)", () => {
    const critique = {
      scores: Object.fromEntries(
        ['engagement', 'intent', 'composition', 'temporal', 'craft'].map((axis) => [
          axis,
          { score: 8, line: 'fine' },
        ]),
      ),
      defects: [],
      fixes: ['hold the end'],
      mechanisms: [{ key: 'drum', present: true }],
      keep: false,
    }
    const stored = { ...DESIGN, mechanisms: ['drum'], critique }
    expect(GraphicCodeSchema.parse(stored)).toEqual(stored)
    expect(GraphicCodeSchema.parse(DESIGN).critique).toBeUndefined()
  })

  it('records the preamble version a design carries, and accepts a design stored before there was one (decision 301)', () => {
    expect(GraphicCodeSchema.parse({ ...DESIGN, motion: 1 })).toEqual({ ...DESIGN, motion: 1 })
    expect(GraphicCodeSchema.parse(DESIGN)).not.toHaveProperty('motion')
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, motion: 0 }).success).toBe(false)
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, motion: 1.5 }).success).toBe(false)
  })

  it('holds the source to 16 KB', () => {
    expect(GRAPHIC_SOURCE_MAX).toBe(16_384)
    const atCap = { ...DESIGN, source: 'x'.repeat(GRAPHIC_SOURCE_MAX) }
    expect(GraphicCodeSchema.safeParse(atCap).success).toBe(true)
    const over = { ...DESIGN, source: 'x'.repeat(GRAPHIC_SOURCE_MAX + 1) }
    expect(GraphicCodeSchema.safeParse(over).success).toBe(false)
  })

  it('holds the title to one line of the slot card, trimmed', () => {
    const long = { ...DESIGN, title: 'x'.repeat(GRAPHIC_TITLE_MAX + 1) }
    expect(GraphicCodeSchema.safeParse(long).success).toBe(false)
    expect(GraphicCodeSchema.parse({ ...DESIGN, title: '  Four billion  ' }).title).toBe(
      'Four billion',
    )
  })

  it('refuses a fact with no text', () => {
    const blank = { ...DESIGN, facts: [{ text: '   ', claimId: CLAIM }] }
    expect(GraphicCodeSchema.safeParse(blank).success).toBe(false)
  })

  it('pins the sandbox version the code was written against', () => {
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, version: 2 }).success).toBe(false)
  })

  it('needs compiled code beside the source', () => {
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, compiled: '' }).success).toBe(false)
  })
})

describe('PlannedGraphicCodeSchema', () => {
  const planned = {
    source: SOURCE,
    title: 'Four billion, on paper',
    facts: [{ text: '$4bn', claim: 1 }],
  }

  it("accepts the model's answer, citing claims by number", () => {
    expect(PlannedGraphicCodeSchema.parse(planned)).toEqual(planned)
  })

  it('refuses a claim number below one, and a fact with no text', () => {
    const zero = { ...planned, facts: [{ text: '$4bn', claim: 0 }] }
    expect(PlannedGraphicCodeSchema.safeParse(zero).success).toBe(false)
    const blank = { ...planned, facts: [{ text: '', claim: 1 }] }
    expect(PlannedGraphicCodeSchema.safeParse(blank).success).toBe(false)
  })

  it('caps the facts manifest', () => {
    const facts = Array.from({ length: GRAPHIC_FACTS_MAX + 1 }, () => ({ text: '$4bn', claim: 1 }))
    expect(PlannedGraphicCodeSchema.safeParse({ ...planned, facts }).success).toBe(false)
  })

  it('may name up to six mechanisms from the list (spec 2026-11-04, section 8.5)', () => {
    const six = ['persistent-actor', 'docking', 'drum', 'reel', 'draw-on', 'tally']
    expect(PlannedGraphicCodeSchema.parse({ ...planned, mechanisms: six }).mechanisms).toEqual(six)
    expect(
      PlannedGraphicCodeSchema.safeParse({ ...planned, mechanisms: [...six, 'door'] }).success,
    ).toBe(false)
    expect(
      PlannedGraphicCodeSchema.safeParse({ ...planned, mechanisms: ['jazz-hands'] }).success,
    ).toBe(false)
  })
})

describe('shownDigitGroups', () => {
  it('judges a count-up by where it lands, not the values on the way', () => {
    expect(shownDigitGroups(['1bn', '2bn', '3bn', '4bn', '4bn', '4bn', '4bn'], 4)).toEqual(['4'])
  })

  it('needs the samples to run in a row', () => {
    expect(shownDigitGroups(['7bn', '7bn', '7bn', '', '7bn', '7bn', '7bn'], 4)).toEqual([])
  })

  it('reads every group in a sample, separators removed, each once, in the order they held', () => {
    const samples = Array.from({ length: 5 }, () => '1,200 staff at 3 sites')
    expect(shownDigitGroups(samples, 4)).toEqual(['1200', '3'])
  })
})

describe('a figure in pieces and a count on its way (decision 449)', () => {
  const B = PIECE_BREAK
  const cites = (figure: string) => ['3.4', '1200'].includes(figure.replace(/,/g, ''))

  it('reads number pieces with only tags between them as the cited figure they make', () => {
    expect(figureReading(`${B}$${B}3${B}.${B}4${B}bn${B}`, cites)).toBe('$ 3.4 bn')
    expect(figureReading(`${B}1${B},${B}200${B} staff`, cites)).toBe('1,200 staff')
  })

  it('keeps pieces apart when they make no cited figure, or when a space stands between them', () => {
    expect(figureReading(`${B}2023${B}${B}45${B}`, cites)).toBe('2023 45')
    expect(figureReading(`${B}3${B} ${B}.4${B}`, cites)).toBe('3 .4')
  })

  it('passes the groups a count strikes on its way up, or down, to a cited figure', () => {
    expect(passedOnTheWay(['1bn', '2bn', '3bn', '3.4bn'], cites)).toEqual(new Set(['1', '2', '3']))
    expect(passedOnTheWay(['9bn', '5bn', '3.4bn'], cites)).toEqual(new Set(['9', '5']))
  })

  it('passes nothing a count leaves for an uncited figure, turns back from, or only sits beside', () => {
    expect(passedOnTheWay(['1bn', '2bn', '7bn'], cites)).toEqual(new Set())
    // 5 falls to 2 and the count turns back up: only the 2 rises straight to 3.4.
    expect(passedOnTheWay(['5bn', '2bn', '3.4bn'], cites)).toEqual(new Set(['2']))
    // A label appearing beside the figure changes the count of groups: no pairing.
    expect(passedOnTheWay(['3.4bn', '3 years 3.4bn'], cites)).toEqual(new Set())
  })

  it('holds a design to what stays a second, less what a count passes', () => {
    const struck = [
      '1',
      '1',
      '1',
      '1',
      '2',
      '2',
      '2',
      '2',
      '3',
      '3',
      '3',
      '3',
      '3.4',
      '3.4',
      '3.4',
      '3.4',
    ]
    expect(shownFigures(struck, 4, ['The figure is 3.4bn.'])).toEqual(['3.4'])
    const label = Array.from({ length: 4 }, () => `${B}3 years${B}${B}3${B}.${B}4${B}`)
    expect(shownFigures(label, 4, ['The figure is 3.4bn.'])).toEqual(['3', '3.4'])
  })
})

describe('graphicFactsIssue', () => {
  const claims = [
    { text: 'The round valued the company at $4 billion.' },
    { text: 'It gave its product away free.' },
    { text: 'Revenue that year was $7 million.' },
  ]

  it('passes a graphic whose numbers and facts are all in the claims it cites', () => {
    expect(
      graphicFactsIssue({
        shown: ['4'],
        facts: [
          { text: '$4bn', claim: 1 },
          { text: 'gave its product away', claim: 2 },
        ],
        claims,
      }),
    ).toBeNull()
  })

  it('passes a graphic that shows no number and cites nothing', () => {
    expect(graphicFactsIssue({ shown: [], facts: [], claims })).toBeNull()
  })

  it('refuses a number no cited claim contains, naming it, even when an uncited claim holds it', () => {
    const shown = shownDigitGroups(['$7bn', '$7bn', '$7bn', '$7bn'], 4)
    expect(graphicFactsIssue({ shown, facts: [{ text: '$4bn', claim: 1 }], claims })).toBe(
      'the graphic shows 7, which no cited claim contains',
    )
  })

  it('refuses a fact its claim does not hold, in digits or in words', () => {
    expect(graphicFactsIssue({ shown: [], facts: [{ text: '$5bn', claim: 1 }], claims })).toBe(
      'fact "$5bn" is not in claim 1',
    )
    expect(
      graphicFactsIssue({ shown: [], facts: [{ text: 'sold at a loss', claim: 2 }], claims }),
    ).toBe('fact "sold at a loss" is not in claim 2')
  })

  it('reads a quoted phrase without its quote marks, case and spacing aside', () => {
    expect(
      graphicFactsIssue({
        shown: [],
        facts: [{ text: '“Gave its  product away”', claim: 2 }],
        claims,
      }),
    ).toBeNull()
  })

  it('refuses a fact that is nothing but quote marks', () => {
    expect(graphicFactsIssue({ shown: [], facts: [{ text: '""', claim: 2 }], claims })).toBe(
      'fact """" is not in claim 2',
    )
  })

  it('refuses a claim number outside the list', () => {
    expect(graphicFactsIssue({ shown: ['4'], facts: [{ text: '$4bn', claim: 4 }], claims })).toBe(
      'fact "$4bn" cites claim 4, which does not exist',
    )
  })

  it('reports the manifest before what the dry run saw', () => {
    expect(graphicFactsIssue({ shown: ['7'], facts: [{ text: '$5bn', claim: 1 }], claims })).toBe(
      'fact "$5bn" is not in claim 1',
    )
  })

  it("passes a number an extra text holds, which no claim number can cite (a chart's series)", () => {
    const series = 'Share price EUR 2020-06-17 104.5 2020-06-26 1.28'
    expect(
      graphicFactsIssue({ shown: ['104.5'], facts: [], claims, extraTexts: [series] }),
    ).toBeNull()
    expect(graphicFactsIssue({ shown: ['104.5'], facts: [], claims })).toBe(
      'the graphic shows 104.5, which no cited claim contains',
    )
    // A claim number still indexes the real claims only: claim 4 is not the extra text.
    expect(
      graphicFactsIssue({
        shown: [],
        facts: [{ text: '104.5', claim: 4 }],
        claims,
        extraTexts: [series],
      }),
    ).toBe('fact "104.5" cites claim 4, which does not exist')
  })
})

describe('the dead-air limit (decision 295)', () => {
  it("is decision 290's six seconds, which the dry run now enforces", () => {
    expect(GRAPHIC_STILL_MAX_MS).toBe(6000)
  })
})

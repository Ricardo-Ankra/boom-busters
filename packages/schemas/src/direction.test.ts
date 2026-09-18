import { describe, expect, it } from 'vitest'
import {
  castWarnings,
  DirectorsBookSchema,
  motifPattern,
  planWarnings,
  renderDirectorsBook,
} from './direction'
import type { ShotBrief } from './visuals'

const book = {
  visualThesis: 'A company that looked solid from the street and hollow from inside.',
  eraLocks: [{ span: '2011 to 2020', rules: 'flat screens, glass offices, smartphones' }],
  palette: { accent: '#c9a227', temperature: 'cold', note: 'gold only on money and signatures' },
  motifs: ['reflections in dark glass', 'empty chairs', 'printed pages under lamplight'],
  anchorObject: 'a bound annual report',
  neverShow: ['cash in bags', 'handcuffs'],
  principals: [
    {
      name: 'Markus Braun',
      role: 'chief executive',
      depiction: 'likeness',
      identityString:
        'Markus Braun, man in his late forties, shaved head, rimless glasses, black turtleneck',
      guardrail: 'shown at podiums and in corridors; never at a desk with documents',
    },
  ],
  locations: [{ name: 'Aschheim headquarters', look: 'glass box on a business park, grey sky' }],
  chapters: [
    {
      chapter: 1,
      dominantShotFamily: 'environment',
      moodShift: 'confident to uneasy',
      keyImage: 'the empty stage after the results presentation',
    },
    {
      chapter: 2,
      dominantShotFamily: 'document',
      moodShift: 'uneasy to exposed',
      keyImage: 'a ledger page with a missing column',
    },
  ],
  finalImage: 'the headquarters at night, one floor lit',
}

describe('DirectorsBookSchema', () => {
  it('accepts a complete book', () => {
    expect(DirectorsBookSchema.safeParse(book).success).toBe(true)
  })

  it('requires exactly three motifs', () => {
    const result = DirectorsBookSchema.safeParse({ ...book, motifs: book.motifs.slice(0, 2) })
    expect(result.success).toBe(false)
  })

  it('requires a guardrail on every principal', () => {
    const principals = [{ ...book.principals[0], guardrail: '' }]
    expect(DirectorsBookSchema.safeParse({ ...book, principals }).success).toBe(false)
  })
})

describe('renderDirectorsBook', () => {
  it('writes the book as prose sections a prompt can carry', () => {
    const text = renderDirectorsBook(DirectorsBookSchema.parse(book))
    expect(text).toContain('Visual thesis:')
    expect(text).toContain(
      'Motifs: reflections in dark glass; empty chairs; printed pages under lamplight',
    )
    expect(text).toContain('Markus Braun (likeness)')
    expect(text).toContain('Chapter 1:')
  })

  it('reads a chapter family as a lean, not a rule (decision 260)', () => {
    expect(renderDirectorsBook(DirectorsBookSchema.parse(book))).toContain(
      'Chapter 1: leans towards environment shots;',
    )
  })
})

const still = (shotSize: 'wide' | 'close', prompt: string): ShotBrief => ({
  type: 'still',
  coversText: 'x',
  description: 'x',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt,
  shotSize,
})

describe('planWarnings', () => {
  const banned = ['cinematic', 'stunning']

  it('flags three adjacent slots at one size', () => {
    const warnings = planWarnings(
      [still('wide', 'a'), still('wide', 'b'), still('wide', 'c')].map((brief) => ({ brief })),
      banned,
    )
    expect(warnings).toEqual([
      expect.stringContaining('three adjacent slots share the size "wide"'),
    ])
  })

  it('flags a banned word in a still prompt, once per word', () => {
    const warnings = planWarnings(
      [{ brief: still('close', 'A cinematic, stunning, cinematic corridor') }],
      banned,
    )
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"cinematic"')
  })

  it('is silent on a varied, clean plan', () => {
    expect(
      planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], banned),
    ).toEqual([])
  })
})

describe('planWarnings: motifs (decision 260)', () => {
  const motifs = ['reflections in dark glass', 'empty chairs', 'server racks']
  const stock = (description: string): ShotBrief => ({
    type: 'stock',
    coversText: 'x',
    description,
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'q',
    rejectionCriteria: [],
  })
  const chart: ShotBrief = {
    type: 'chart',
    coversText: 'x',
    description: 'a server rack chart',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'bar',
    series: [
      {
        label: 'a',
        unit: 'USD',
        points: [
          { x: '2019', y: 1 },
          { x: '2020', y: 2 },
        ],
      },
    ],
    dataRefs: ['01HQ00000000000000000000AA'],
    takeaway: 't',
    reveal: 'none',
  }

  it('counts a motif in more than one picture brief of a chapter, by its head noun, and flags neighbours', () => {
    const warnings = planWarnings(
      [
        { brief: still('wide', 'A server rack humming in the dark'), chapter: 'chapter 3' },
        { brief: stock('Rows of server racks'), chapter: 'chapter 3' },
        { brief: still('close', 'A ledger on a desk'), chapter: 'chapter 3' },
      ],
      [],
      motifs,
    )
    expect(warnings).toEqual([
      'motif "server racks" appears in 2 of 3 picture briefs in chapter 3',
      'motif "server racks" appears in two adjacent slots (from slot 0)',
    ])
  })

  it('is silent when each motif appears once per chapter, however many chapters', () => {
    expect(
      planWarnings(
        [
          { brief: still('wide', 'an empty chair'), chapter: 'chapter 1' },
          { brief: still('close', 'a ledger'), chapter: 'chapter 1' },
          { brief: still('wide', 'an empty chair at the head of the table'), chapter: 'chapter 2' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
  })

  it('matches the head noun and its plural, never the modifier, and skips data briefs', () => {
    expect(
      planWarnings(
        [
          { brief: stock('Deserted office, empty desks'), chapter: 'c' },
          { brief: stock('More empty desks'), chapter: 'c' },
          { brief: chart, chapter: 'c' },
          { brief: chart, chapter: 'c' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
    expect(motifPattern('reflections in dark glass')?.test('her glasses on the desk')).toBe(true)
    expect(motifPattern('server racks')?.test('a rack of servers')).toBe(true)
    expect(motifPattern('[mock] empty chairs')?.test('empty desks')).toBe(false)
    expect(motifPattern('')).toBeNull()
  })

  it('changes nothing for a caller that passes no motifs', () => {
    expect(
      planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], []),
    ).toEqual([])
  })
})

describe('castWarnings', () => {
  it('names each cast member the book left out, case-insensitively, and nothing else', () => {
    expect(castWarnings(book, ['markus braun', 'Jan Marsalek'])).toEqual([
      'the book has no principal for Jan Marsalek; redraft the direction or add them by hand',
    ])
    expect(castWarnings(null, ['Jan Marsalek'])).toEqual([])
    expect(castWarnings(book, [])).toEqual([])
  })
})

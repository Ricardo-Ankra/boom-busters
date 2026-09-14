import { describe, expect, it } from 'vitest'
import { DirectorsBookSchema, planWarnings, renderDirectorsBook } from './direction'
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

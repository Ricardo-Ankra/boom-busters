// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@boom-busters/db'
import { DESIGNS } from '@boom-busters/providers'
import { GRAPHIC_CODE_VERSION, cardWords } from '@boom-busters/schemas'

// The approved row belongs to one technique (the chapter title unless a test says otherwise).
const approved = vi.hoisted(() => ({ row: null as unknown, technique: 'chapter-title' }))
vi.mock('@boom-busters/db', () => ({
  approvedExemplar: async (_db: unknown, _channel: string, technique: string) =>
    technique === approved.technique ? approved.row : null,
}))

// The house design compiles for real unless a test sets `compile.override`.
const compile = vi.hoisted(() => ({
  override: null as null | (() => { ok: true; compiled: string } | { ok: false; issue: string }),
}))
vi.mock('@/lib/graphic-code/compile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/graphic-code/compile')>()
  return {
    ...actual,
    compileGraphicSource: (source: string) =>
      compile.override ? compile.override() : actual.compileGraphicSource(source),
  }
})

import { cardCodesFor, isTitleOnlySample } from './card-exemplars'

const db = {} as Database
const words = (...texts: string[]) => texts.map((text, i) => ({ text, atMs: 300 + 250 * i }))

function row(version: number, codeWords: ReturnType<typeof words>) {
  return {
    version,
    code: {
      version: GRAPHIC_CODE_VERSION,
      compiled: `channel-v${version}`,
      title: 'Mine',
      words: codeWords,
    },
  }
}

describe('isTitleOnlySample', () => {
  it('is true for a title alone, even one ending in a full stop', () => {
    expect(isTitleOnlySample(cardWords('The missing billion.'))).toBe(true)
    expect(isTitleOnlySample(words('Nobody'))).toBe(true)
  })
  it('is false when a word before the last ends a sentence', () => {
    expect(isTitleOnlySample(words('Part', 'one.', 'The', 'missing', 'billion.'))).toBe(false)
  })
})

describe('cardCodesFor', () => {
  beforeEach(() => {
    approved.row = null
    approved.technique = 'chapter-title'
    compile.override = null
  })

  it("uses the channel's approved chapter title when its sample is title only", async () => {
    approved.row = row(3, cardWords('The missing billion.'))
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.chapter).toEqual({
      version: GRAPHIC_CODE_VERSION,
      compiled: 'channel-v3',
      title: 'Mine',
    })
    expect(cards.notes).toEqual([])
  })

  it('falls back to the house chapter title for a labelled channel version', async () => {
    approved.row = row(2, words('Part', 'one.', 'The', 'missing', 'billion.'))
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.chapter?.title).toBe(DESIGNS['chapter-title']!.title)
    expect(cards.chapter?.compiled).not.toBe('channel-v2')
    expect(cards.notes).toHaveLength(1)
    expect(cards.notes[0]).toContain('v2')
  })

  it('uses the house design when the channel has none approved', async () => {
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.chapter?.title).toBe(DESIGNS['chapter-title']!.title)
    expect(cards.chapter?.compiled).toContain('function Graphic')
    expect(cards.chapter?.version).toBe(GRAPHIC_CODE_VERSION)
    expect(cards.notes).toEqual([])
  })

  it('uses the house film title when the channel has none approved', async () => {
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.title?.title).toBe(DESIGNS['film-title']!.title)
    expect(cards.title?.compiled).toContain('function Graphic')
    expect(cards.title?.version).toBe(GRAPHIC_CODE_VERSION)
    expect(cards.title?.compiled).not.toBe(cards.chapter?.compiled)
  })

  it("uses the channel's approved film title when its sample is title only", async () => {
    approved.technique = 'film-title'
    approved.row = row(4, cardWords('The Wirecard Collapse'))
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.title).toEqual({
      version: GRAPHIC_CODE_VERSION,
      compiled: 'channel-v4',
      title: 'Mine',
    })
  })

  it('falls back to the house film title for a labelled channel version, with a note', async () => {
    approved.technique = 'film-title'
    approved.row = row(5, words('Part', 'one.', 'The', 'Wirecard', 'Collapse'))
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.title?.title).toBe(DESIGNS['film-title']!.title)
    expect(cards.notes.some((note) => note.includes('Film title v5'))).toBe(true)
  })

  it('falls back to the plain card, with a note, when the house card cannot be compiled', async () => {
    compile.override = () => {
      throw new Error('the esbuild binary is missing')
    }
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.chapter).toBeNull()
    expect(cards.title).toBeNull()
    expect(cards.notes).toHaveLength(2)
    expect(cards.notes[0]).toContain('house chapter title could not be compiled')
    expect(cards.notes[0]).toContain('esbuild binary is missing')
    expect(cards.notes[1]).toContain('house film title could not be compiled')
  })

  it('notes a house card whose compile is refused rather than failing silently', async () => {
    compile.override = () => ({ ok: false, issue: 'the code does not compile: bad token' })
    const cards = await cardCodesFor(db, 'ch1')
    expect(cards.chapter).toBeNull()
    expect(cards.notes.some((note) => note.includes('bad token'))).toBe(true)
  })
})

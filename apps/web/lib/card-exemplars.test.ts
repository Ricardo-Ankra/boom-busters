// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@boom-busters/db'
import { DESIGNS } from '@boom-busters/providers'
import { GRAPHIC_CODE_VERSION, cardWords } from '@boom-busters/schemas'

const approved = vi.hoisted(() => ({ row: null as unknown }))
vi.mock('@boom-busters/db', () => ({
  approvedExemplar: async () => approved.row,
}))

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

  it('has no title card while no film-title design exists', async () => {
    expect((await cardCodesFor(db, 'ch1')).title).toBeNull()
  })
})

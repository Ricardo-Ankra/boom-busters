import {
  BibleResearchDigestSchema,
  EMPTY_BIBLE,
  bibleDraftUnits,
  isBibleComplete,
} from '@boom-busters/schemas'
import type { BibleDraftInputs, ChannelBible } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { bibleUnitSchema, mergeBibleUnit } from './bible-draft'
import { FINANCE_WORDS, mockBibleUnit, mockResearchDigest } from './bible-mocks'

const INPUTS: BibleDraftInputs = {
  description: 'psychology experiments',
  audience: '',
  admiredChannels: [],
  videos: [],
  avoid: '',
}

function eightWordRuns(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const runs = new Set<string>()
  for (let i = 0; i + 8 <= words.length; i += 1) runs.add(words.slice(i, i + 8).join(' '))
  return runs
}

describe('mockBibleUnit', () => {
  const units = bibleDraftUnits()

  it.each(units.map((unit) => [JSON.stringify(unit), unit] as const))(
    'answers %s in the shape its schema wants',
    (_name, unit) => {
      expect(() => bibleUnitSchema(unit).parse(mockBibleUnit(unit))).not.toThrow()
    },
  )

  it('fills a whole bible with no finance wording', () => {
    let bible: ChannelBible = EMPTY_BIBLE
    for (const unit of units) bible = mergeBibleUnit(bible, unit, mockBibleUnit(unit))
    expect(isBibleComplete(bible)).toBe(true)
    const text = JSON.stringify(bible).toLowerCase()
    for (const word of FINANCE_WORDS) expect(text).not.toContain(word)
  })

  it('answers one slot with that slot alone', () => {
    const answer = mockBibleUnit({ section: 'examples', slotId: 'script-foreshadow' })
    expect(Object.keys(answer.examples ?? {})).toEqual(['script-foreshadow'])
  })

  it('draws the hooks unit from videos the mock digest lists', () => {
    const digest = mockResearchDigest(INPUTS)
    const known = new Set(digest.videos.map((v) => `${v.videoId}|${v.channel}|${v.title}`))
    const answer = mockBibleUnit({ section: 'hooks' })
    for (const list of [answer.hooks, answer.openings, answer.titles]) {
      expect(list).toHaveLength(2)
      for (const entry of list ?? []) {
        expect(entry.drawnFrom.length).toBeGreaterThan(0)
        for (const from of entry.drawnFrom) {
          expect(known.has(`${from.videoId}|${from.channel}|${from.title}`)).toBe(true)
        }
      }
    }
  })
})

describe('mockResearchDigest', () => {
  const digest = mockResearchDigest(INPUTS)

  it('is a valid digest of the recorded videos, own ones marked', () => {
    expect(() => BibleResearchDigestSchema.parse(digest)).not.toThrow()
    expect(digest.videos.some((v) => v.own)).toBe(true)
    expect(digest.videos.some((v) => !v.own)).toBe(true)
    expect(digest.patterns.map((p) => p.kind).sort()).toEqual([
      'audience',
      'hook',
      'opening',
      'title',
    ])
  })

  it('shares no eight-word run with the mock hooks, openings or titles', () => {
    const quotes = new Set<string>()
    for (const pattern of digest.patterns) {
      for (const run of eightWordRuns(pattern.quote ?? '')) quotes.add(run)
    }
    expect(quotes.size).toBeGreaterThan(0)
    const answer = mockBibleUnit({ section: 'hooks' })
    const lines = [...(answer.hooks ?? []), ...(answer.openings ?? []), ...(answer.titles ?? [])]
    for (const line of lines) {
      for (const run of eightWordRuns(line.text)) expect(quotes.has(run)).toBe(false)
    }
  })
})

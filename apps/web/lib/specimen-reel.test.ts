import { describe, expect, it } from 'vitest'
import { cardDurationMs, cardWords } from '@boom-busters/schemas'
import type { GraphicCode } from '@boom-busters/schemas'
import type { ChannelExemplarView } from './exemplar-channel-views'
import type { ExemplarView } from './exemplar-views'
import { specimenReel } from './specimen-reel'

const TITLE = "The Money That Wasn't There"

function code(tag: string): GraphicCode {
  return {
    version: 1,
    source: `// ${tag}`,
    compiled: `/* ${tag} */`,
    title: tag,
    facts: [],
    words: [{ text: tag, atMs: 400 }],
    durationMs: 5000,
    motion: 1,
  }
}

function house(technique: string, extra: Partial<ExemplarView> = {}): ExemplarView {
  return {
    technique: technique as ExemplarView['technique'],
    description: '',
    template: { name: 't', repository: 'r', url: 'u', licence: 'MIT' },
    code: code(`house-${technique}`),
    ...extra,
  }
}

function channelView(technique: string, approved: boolean): ChannelExemplarView {
  return {
    technique,
    name: null,
    description: '',
    channelOnly: false,
    steerPhrases: [],
    fromReference: null,
    approved: approved
      ? ({
          code: code(`channel-${technique}`),
          data: { series: [], takeaway: 'ch' },
        } as unknown as NonNullable<ChannelExemplarView['approved']>)
      : null,
    pendingDraft: null,
    versions: [],
  }
}

const HOUSE = ['chapter-title', 'lower-third', 'bar-chart', 'stat-counter'].map((t) => house(t))

describe('specimenReel', () => {
  it('orders and labels the pieces, leaving out a film title nobody has', () => {
    const reel = specimenReel(HOUSE, [])
    expect(reel.map((p) => [p.technique, p.label, p.source])).toEqual([
      ['chapter-title', 'Chapter card', 'house'],
      ['lower-third', 'Lower third', 'house'],
      ['bar-chart', 'Chart', 'house'],
      ['stat-counter', 'Counter', 'house'],
    ])
  })

  it('puts the film title first when either side has it', () => {
    expect(specimenReel([house('film-title'), ...HOUSE], [])[0]?.label).toBe('Film title')
    const reel = specimenReel(HOUSE, [channelView('film-title', true)])
    expect(reel[0]).toMatchObject({ label: 'Film title', source: 'channel' })
  })

  it('prefers the channel approved code and ignores an unapproved view', () => {
    const reel = specimenReel(HOUSE, [
      channelView('lower-third', true),
      channelView('bar-chart', false),
    ])
    const lower = reel.find((p) => p.technique === 'lower-third')!
    expect(lower.source).toBe('channel')
    expect(lower.payload?.compiled).toContain('channel-lower-third')
    expect(reel.find((p) => p.technique === 'bar-chart')?.source).toBe('house')
  })

  it('gives card pieces the card words and duration, others their own', () => {
    const reel = specimenReel(HOUSE, [])
    const card = reel.find((p) => p.technique === 'chapter-title')!.payload!
    expect(card.words).toEqual(cardWords(TITLE))
    expect(card.durationMs).toBe(cardDurationMs(TITLE))
    const lower = reel.find((p) => p.technique === 'lower-third')!.payload!
    expect(lower.words).toEqual([{ text: 'house-lower-third', atMs: 400 }])
    expect(lower.durationMs).toBe(5000)
    expect(lower.logos).toEqual({})
    expect(lower.claimIds).toEqual([])
  })

  it('keeps a chart sample data and turns a house issue into a piece without a payload', () => {
    const data = { series: [], takeaway: 'sample' }
    const reel = specimenReel(
      [
        house('bar-chart', { data }),
        house('stat-counter', { code: undefined, issue: 'did not compile' }),
      ],
      [],
    )
    expect(reel[0]?.payload?.data).toEqual(data)
    expect(reel[1]).toEqual({
      technique: 'stat-counter',
      label: 'Counter',
      source: 'house',
      issue: 'did not compile',
    })
  })
})

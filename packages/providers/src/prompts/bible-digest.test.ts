import { BibleResearchDigestSchema } from '@boom-busters/schemas'
import type { BibleDraftInputs } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildResearchDigestRequest, parseResearchDigest } from './bible-digest'
import { mockResearchDigest } from './bible-mocks'

const INPUTS: BibleDraftInputs = {
  description: 'psychology experiments',
  audience: 'curious adults',
  admiredChannels: [],
  videos: [],
  avoid: 'celebrity gossip',
}

describe('buildResearchDigestRequest', () => {
  const request = buildResearchDigestRequest({
    channelName: 'Quiet Minds',
    inputs: INPUTS,
    videos: [{ videoId: 'abc123', channel: 'Other', title: 'A Title', views: 1200, own: false }],
    openings: [{ videoId: 'abc123', text: 'It began in a basement.' }],
    ownLines: ['Our own line [[example:x-y]]'],
  })

  it('is a bible task asking for JSON only', () => {
    expect(request.task).toBe('bible')
    expect(request.messages[0]!.content).toContain('Answer with one JSON object')
  })

  it('carries the videos, openings and own lines, and keeps owner brackets literal', () => {
    const content = request.messages[0]!.content
    expect(content).toContain('abc123 | A Title | Other | other | 1200 views')
    expect(content).toContain('It began in a basement.')
    expect(content).toContain('Our own line [[example:x-y]]')
    expect(content).not.toContain('')
  })

  it('asks for source ids and a quote of at most 200 characters', () => {
    expect(request.messages[0]!.content).toContain('at most 200 characters')
    expect(request.messages[0]!.content).toContain('videoId')
  })
})

describe('the digest schema', () => {
  it('refuses a 201-character quote and takes a 200-character one', () => {
    const digest = mockResearchDigest(INPUTS)
    const withQuote = (quote: string) => ({
      ...digest,
      patterns: [{ ...digest.patterns[0]!, quote }],
    })
    expect(BibleResearchDigestSchema.safeParse(withQuote('a'.repeat(201))).success).toBe(false)
    expect(BibleResearchDigestSchema.safeParse(withQuote('a'.repeat(200))).success).toBe(true)
  })
})

describe('parseResearchDigest', () => {
  it('reads a fenced answer and keeps each pattern its sources', () => {
    const digest = mockResearchDigest(INPUTS)
    const parsed = parseResearchDigest('Here:\n```json\n' + JSON.stringify(digest) + '\n```')
    expect(parsed.patterns[0]!.sources.length).toBeGreaterThan(0)
    expect(parsed).toEqual(digest)
  })

  it('throws on a quote over the limit', () => {
    const digest = mockResearchDigest(INPUTS)
    digest.patterns[0]!.quote = 'a'.repeat(201)
    expect(() => parseResearchDigest(JSON.stringify(digest))).toThrow(/research digest/)
  })
})

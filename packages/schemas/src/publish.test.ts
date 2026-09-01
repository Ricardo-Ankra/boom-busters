import { describe, expect, it } from 'vitest'
import {
  composeDescription,
  DESCRIPTION_MAX_CHARS,
  formatTimestamp,
  PUBLISH_DISCLAIMER,
  PublishDraftSchema,
} from './publish'

describe('formatTimestamp', () => {
  it('renders minutes:seconds under an hour and h:mm:ss over it', () => {
    expect(formatTimestamp(0)).toBe('0:00')
    expect(formatTimestamp(61_000)).toBe('1:01')
    expect(formatTimestamp(825_000)).toBe('13:45')
    expect(formatTimestamp(3_600_000)).toBe('1:00:00')
    expect(formatTimestamp(4_923_000)).toBe('1:22:03')
  })

  it('floors rather than rounds — a chapter never starts before its stamp', () => {
    expect(formatTimestamp(59_900)).toBe('0:59')
  })
})

describe('composeDescription', () => {
  const chapters = [
    { title: 'The rise', startMs: 0 },
    { title: 'The hole', startMs: 312_400 },
    { title: 'The fall', startMs: 771_900 },
  ]

  it('stacks body, chapters, sources and the disclaimer in order', () => {
    const { description, droppedSources } = composeDescription({
      body: 'On a June morning, 1.9 billion euros stopped existing.',
      chapters,
      sources: ['https://example.com/ft-report', 'https://example.com/filing'],
    })

    const blocks = description.split('\n\n')
    expect(blocks[0]).toContain('1.9 billion euros')
    expect(blocks[1]).toBe('Chapters:\n0:00 The rise\n5:12 The hole\n12:51 The fall')
    expect(blocks[2]).toBe('Sources:\nhttps://example.com/ft-report\nhttps://example.com/filing')
    expect(blocks[3]).toBe(PUBLISH_DISCLAIMER)
    expect(droppedSources).toBe(0)
  })

  it('forces the first chapter stamp to 0:00 whatever the timeline says', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: [{ title: 'Cold open', startMs: 1_800 }, ...chapters.slice(1)],
      sources: [],
    })
    expect(description).toContain('0:00 Cold open')
  })

  it('omits the chapter block below three chapters — YouTube ignores them', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: chapters.slice(0, 2),
      sources: [],
    })
    expect(description).not.toContain('Chapters:')
  })

  it('omits the source block when there are none, and never the disclaimer', () => {
    const { description } = composeDescription({ body: 'Body.', chapters: [], sources: [] })
    expect(description).not.toContain('Sources:')
    expect(description.endsWith(PUBLISH_DISCLAIMER)).toBe(true)
  })

  it('drops sources from the end to fit the ceiling, and says how many', () => {
    const sources = Array.from(
      { length: 60 },
      (_, i) => `https://example.com/${'a'.repeat(90)}/${i}`,
    )
    const { description, droppedSources } = composeDescription({
      body: 'Body.',
      chapters,
      sources,
    })

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS)
    expect(droppedSources).toBeGreaterThan(0)
    expect(description).toContain('https://example.com/')
    // The disclaimer survives the squeeze; the last sources do not.
    expect(description.endsWith(PUBLISH_DISCLAIMER)).toBe(true)
    expect(description).not.toContain('/59')
  })

  it('publishes the music attribution as its own block, between chapters and sources', () => {
    // Decision 207: the licence rides with every upload that uses the track,
    // so a Content ID claim is answered by the video's own description.
    const { description } = composeDescription({
      body: 'Body.',
      chapters,
      sources: ['https://example.com/filing'],
      musicAttribution: 'Music by Lesfm from Pixabay. Pixabay Content Licence.',
    })

    const blocks = description.split('\n\n')
    expect(blocks[2]).toBe('Music:\nMusic by Lesfm from Pixabay. Pixabay Content Licence.')
    expect(blocks[3]).toContain('Sources:')
  })

  it('omits the music block when there is no bed or no text — never an empty heading', () => {
    const bare = composeDescription({ body: 'Body.', chapters: [], sources: [] })
    expect(bare.description).not.toContain('Music:')
    const blank = composeDescription({
      body: 'Body.',
      chapters: [],
      sources: [],
      musicAttribution: '   ',
    })
    expect(blank.description).not.toContain('Music:')
  })

  it('keeps the music attribution while sources are dropped to fit — licence copy never loses', () => {
    const sources = Array.from(
      { length: 60 },
      (_, i) => `https://example.com/${'a'.repeat(90)}/${i}`,
    )
    const { description, droppedSources } = composeDescription({
      body: 'Body.',
      chapters,
      sources,
      musicAttribution: 'Music by Lesfm from Pixabay.',
    })

    expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS)
    expect(droppedSources).toBeGreaterThan(0)
    expect(description).toContain('Music:\nMusic by Lesfm from Pixabay.')
  })
})

describe('PublishDraftSchema', () => {
  it('defaults the lists and tolerates the final metadata keys beside it', () => {
    const draft = PublishDraftSchema.parse({
      title: 'How Wirecard Fell',
      description: 'final composed text lives in the same jsonb',
    })
    expect(draft.titleOptions).toEqual([])
    expect(draft.tags).toEqual([])
  })

  it('refuses an overlong title — YouTube would truncate it silently', () => {
    expect(PublishDraftSchema.safeParse({ title: 'x'.repeat(101) }).success).toBe(false)
  })
})

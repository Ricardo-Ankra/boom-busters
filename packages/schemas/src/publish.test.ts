import { describe, expect, it } from 'vitest'
import {
  composeDescription,
  DESCRIPTION_MAX_CHARS,
  formatTimestamp,
  PUBLISH_DISCLAIMER,
  PublishDraftSchema,
  sourceLabel,
  splitHashtags,
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

/**
 * Decision 303: the description is written for search too. A chapter line
 * carries a gloss that says what the chapter is about, a source line says
 * what it backs, and three hashtags get a line of their own.
 */
describe('composeDescription for search (decision 303)', () => {
  const chapters = [
    { title: 'Stepping Down', startMs: 0, gloss: 'Emad Mostaque resigns as CEO, March 2024' },
    { title: 'The Borrowed Engine', startMs: 45_000 },
    { title: 'Exhibit A', startMs: 311_000, gloss: '  Getty Images and the artists sue  ' },
  ]

  it('glosses a chapter line when it has one, and leaves a bare title alone', () => {
    const { description } = composeDescription({ body: 'Body.', chapters, sources: [] })
    expect(description).toContain(
      'Chapters:\n0:00 Stepping Down: Emad Mostaque resigns as CEO, March 2024\n' +
        '0:45 The Borrowed Engine\n5:11 Exhibit A: Getty Images and the artists sue',
    )
  })

  it('labels a source line when it has a label, and keeps a bare URL as it was', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: [],
      sources: [
        { url: 'https://arxiv.org/abs/2112.10752', label: 'arXiv, the latent diffusion paper' },
        { url: 'https://stability.ai/news', label: null },
        'https://example.com/filing',
      ],
    })
    expect(description).toContain(
      'Sources:\narXiv, the latent diffusion paper: https://arxiv.org/abs/2112.10752\n' +
        'https://stability.ai/news\nhttps://example.com/filing',
    )
  })

  it('puts the hashtags on their own line before the disclaimer, three at most, each one word', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: [],
      sources: ['https://example.com/filing'],
      hashtags: ['#StabilityAI', 'StableDiffusion', '#AI Documentary', '#Fourth', '#Fifth'],
    })
    const blocks = description.split('\n\n')
    expect(blocks.at(-2)).toBe('#StabilityAI #StableDiffusion #AIDocumentary')
    expect(blocks.at(-1)).toBe(PUBLISH_DISCLAIMER)
  })

  it('keeps a gloss on its chapter line, whatever whitespace it carries', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: [
        { title: 'One', startMs: 0, gloss: 'A gloss\nthat wrapped' },
        { title: 'Two', startMs: 60_000 },
        { title: 'Three', startMs: 120_000 },
      ],
      sources: [],
    })
    expect(description).toContain('0:00 One: A gloss that wrapped\n1:00 Two')
  })

  it('omits the hashtag line when there are none', () => {
    const { description } = composeDescription({
      body: 'Body.',
      chapters: [],
      sources: [],
      hashtags: ['  ', '#'],
    })
    expect(description.split('\n\n')).toEqual(['Body.', PUBLISH_DISCLAIMER])
  })
})

/**
 * Decision 303, review: a label publishes only the outlet's own words. Claim
 * text was written for research and cutting it could drop the very clause
 * that attributed or hedged it, so it is never printed.
 */
describe('sourceLabel (decision 303)', () => {
  it("quotes the outlet's own headline when the article record read one", () => {
    expect(
      sourceLabel({
        url: 'https://forbes.com/sites/kenrickcai/2023/06/04/stable-diffusion',
        outlet: 'Forbes',
        headline: "Stable Diffusion's Founder Has A Track Record Of Exaggeration",
      }),
    ).toBe('Forbes, "Stable Diffusion\'s Founder Has A Track Record Of Exaggeration"')
  })

  it('is the outlet alone without a headline, and the host without an outlet', () => {
    expect(
      sourceLabel({
        url: 'https://www.theinformation.com/',
        outlet: 'The Information',
        headline: null,
      }),
    ).toBe('The Information')
    expect(
      sourceLabel({ url: 'https://www.stability.ai/news', outlet: null, headline: null }),
    ).toBe('stability.ai')
  })

  it('never cuts a headline it quotes', () => {
    const headline = 'A headline that runs on '.repeat(8).trim()
    expect(sourceLabel({ url: 'https://example.com/a', outlet: 'Example', headline })).toBe(
      `Example, "${headline}"`,
    )
  })
})

describe('splitHashtags (decision 303)', () => {
  it('reads commas and hash marks as boundaries, and joins the words inside one tag', () => {
    expect(splitHashtags('Stability AI, #Fraud #AI Documentary')).toEqual([
      '#StabilityAI',
      '#Fraud',
      '#AIDocumentary',
    ])
    expect(splitHashtags('  ,  #,')).toEqual([])
    expect(splitHashtags('#Wirecard, wirecard')).toEqual(['#Wirecard'])
  })
})

describe('PublishDraftSchema', () => {
  it('reads the search fields and the script version the opening was written for (decision 303)', () => {
    const draft = PublishDraftSchema.parse({
      descriptionBody: 'How Stability AI...',
      bodyScriptVersion: 4,
      chapterGlosses: { '01HQ0000000000000000000CH1': 'Emad Mostaque resigns' },
      hashtags: ['#StabilityAI'],
    })
    expect(draft.bodyScriptVersion).toBe(4)
    expect(draft.chapterGlosses).toEqual({ '01HQ0000000000000000000CH1': 'Emad Mostaque resigns' })
    expect(draft.hashtags).toEqual(['#StabilityAI'])
    const bare = PublishDraftSchema.parse({})
    expect(bare.chapterGlosses).toEqual({})
    expect(bare.hashtags).toEqual([])
    expect(bare.bodyScriptVersion).toBeUndefined()
  })

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

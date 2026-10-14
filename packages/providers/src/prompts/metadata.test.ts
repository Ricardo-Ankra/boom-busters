import { describe, expect, it } from 'vitest'
import { CHAPTER_GLOSS_MAX, ValidationError } from '@boom-busters/schemas'
import {
  buildDescriptionRequest,
  buildTitlesRequest,
  DESCRIPTION_BODY_MAX,
  mockDescription,
  mockTitleOptions,
  parseDescriptionAnswer,
  parseTitleOptions,
  TITLE_OPTION_COUNT,
} from './metadata'
import type { Note, Repair } from './repair'
import type { ScriptClaim } from './script'

const CLAIM: ScriptClaim = {
  id: '01HQ00000000000000000000AA',
  text: 'Stability AI announced a 101 million dollar funding round in October 2022.',
  sourceUrl: 'https://stability.ai/news',
  confidence: 'sourced',
}

describe('buildTitlesRequest', () => {
  const request = buildTitlesRequest({
    caseTitle: 'Wirecard',
    hook: 'On a June morning in 2020, 1.9 billion euros stopped existing.',
    target: 'master',
    workingTitle: 'Wirecard: The 1.9 Billion Euro Lie',
  })

  it('is a metadata task asking for exactly the option count', () => {
    expect(request.task).toBe('metadata')
    expect(request.system).toContain(`exactly ${TITLE_OPTION_COUNT} strings`)
  })

  it('carries the case, the working title and the hook', () => {
    const content = request.messages.map((m) => m.content).join('\n')
    expect(content).toContain('Wirecard')
    expect(content).toContain('1.9 billion euros stopped existing')
  })

  it('tells the model when the titles are for a Short', () => {
    const short = buildTitlesRequest({
      caseTitle: 'Wirecard',
      hook: 'hook',
      target: 'short',
      workingTitle: 'title',
    })
    expect(short.system).toContain('vertical Short')
    expect(request.system).not.toContain('vertical Short')
  })
})

/**
 * Decision 301: the titles were fed the project's pitch title, which carried
 * "$270M in 18 Months", a figure the dossier flagged as unsourced, and five
 * of eight options repeated it. Titles are now grounded in the claim list.
 */
describe('buildTitlesRequest grounding (decision 301)', () => {
  const grounded = buildTitlesRequest({
    caseTitle: 'Stability AI: The Startup That Burned $270M in 18 Months',
    hook: 'March 2024. Emad Mostaque resigned.',
    target: 'master',
    workingTitle: 'Stability AI: The Startup That Burned $270M in 18 Months',
    claims: [CLAIM],
    centralQuestion: 'What was Stability AI giving away, and what did it keep?',
  })

  it('hands the model the claim list and the central question', () => {
    const content = grounded.messages.map((m) => m.content).join('\n')
    expect(content).toContain('Stability AI announced a 101 million dollar funding round')
    expect(content).toContain('What was Stability AI giving away')
  })

  it('says the pitch may be wrong and every figure must come from the claims', () => {
    expect(grounded.system).toMatch(/early pitch/)
    expect(grounded.system).toMatch(
      /Every figure, date and name in a title must appear in the claim list/,
    )
  })
})

describe('buildDescriptionRequest (decision 301)', () => {
  const request = buildDescriptionRequest({
    target: 'master',
    claims: [CLAIM],
    centralQuestion: 'What was Stability AI giving away, and what did it keep?',
    chapters: [
      {
        title: 'Stepping Down',
        text: '[pause] March 2024. Emad Mostaque resigned as chief executive.',
      },
      { title: 'The Borrowed Engine', text: 'The method was not Stability AI’s.' },
    ],
  })

  it('is a metadata task that never sees the pitch title', () => {
    expect(request.task).toBe('metadata')
    const content = request.messages.map((m) => m.content).join('\n')
    expect(content).not.toContain('$270M')
    expect(content).toContain('101 million dollar funding round')
    expect(content).toContain('1. Stepping Down')
    // Narration tags are direction, not words the description could quote.
    expect(content).not.toContain('[pause]')
  })

  it('asks for the opening, one gloss per chapter, three hashtags and tags', () => {
    expect(request.system).toContain('"body"')
    expect(request.system).toContain('"chapterGlosses"')
    expect(request.system).toContain('exactly 2 strings')
    expect(request.system).toContain('"hashtags"')
    expect(request.system).toContain('"tags"')
    expect(request.system).toMatch(/Assert nothing the claim list does not support/)
    expect(request.system).toMatch(/first sentence names the company/i)
  })

  it('asks a Short for one or two sentences and no chapter glosses', () => {
    const short = buildDescriptionRequest({
      target: 'short',
      claims: [CLAIM],
      chapters: [],
      shortText: 'March 2024. The chief executive of Stability AI steps down.',
    })
    expect(short.system).toMatch(/vertical Short/)
    expect(short.system).toContain('exactly 0 strings')
    expect(short.messages.map((m) => m.content).join('\n')).toContain(
      'The chief executive of Stability AI steps down',
    )
  })
})

describe('parseDescriptionAnswer (decision 301)', () => {
  const answer = (over: Record<string, unknown>) =>
    JSON.stringify({
      body: 'How Stability AI, the company behind Stable Diffusion, lost its founder.',
      chapterGlosses: ['Emad Mostaque resigns, March 2024', 'The CompVis paper'],
      hashtags: ['#StabilityAI', '#StableDiffusion', '#AIDocumentary'],
      tags: ['Stability AI', 'Stable Diffusion'],
      ...over,
    })

  it('reads a clean answer', () => {
    expect(parseDescriptionAnswer(answer({}), 2)).toEqual({
      body: 'How Stability AI, the company behind Stable Diffusion, lost its founder.',
      chapterGlosses: ['Emad Mostaque resigns, March 2024', 'The CompVis paper'],
      hashtags: ['#StabilityAI', '#StableDiffusion', '#AIDocumentary'],
      tags: ['Stability AI', 'Stable Diffusion'],
    })
  })

  it('fits the glosses to the chapters: extra ones capped and noted, missing ones empty', () => {
    const repairs: Repair[] = []
    const note: Note = (repair) => repairs.push(repair)
    expect(
      parseDescriptionAnswer(answer({ chapterGlosses: ['a', 'b', 'c'] }), 2, note).chapterGlosses,
    ).toEqual(['a', 'b'])
    expect(repairs).toEqual([{ action: 'capped', field: 'chapter glosses', kept: 2 }])
    expect(parseDescriptionAnswer(answer({ chapterGlosses: ['a'] }), 3).chapterGlosses).toEqual([
      'a',
      '',
      '',
    ])
  })

  it('trims a long gloss at a word and a long body at a sentence, saying so', () => {
    const repairs: Repair[] = []
    const note: Note = (repair) => repairs.push(repair)
    const parsed = parseDescriptionAnswer(
      answer({
        body: `${'A sentence about the company. '.repeat(80)}The end.`,
        chapterGlosses: ['word '.repeat(40), 'ok'],
      }),
      2,
      note,
    )
    expect(parsed.body.length).toBeLessThanOrEqual(DESCRIPTION_BODY_MAX)
    expect(parsed.body.endsWith('.')).toBe(true)
    expect(parsed.chapterGlosses[0]!.length).toBeLessThanOrEqual(CHAPTER_GLOSS_MAX)
    expect(repairs).toEqual([
      { action: 'trimmed', field: 'the opening' },
      { action: 'trimmed', field: "chapter 1's gloss" },
    ])
  })

  it('keeps three one-word hashtags, and tags inside YouTube’s 500 characters', () => {
    const parsed = parseDescriptionAnswer(
      answer({
        hashtags: ['StabilityAI', '#AI Documentary', '#StabilityAI', '#Four', '#Five'],
        tags: Array.from({ length: 40 }, (_, i) => `a fairly long search tag number ${i}`),
      }),
      2,
    )
    expect(parsed.hashtags).toEqual(['#StabilityAI', '#AIDocumentary', '#Four'])
    expect(parsed.tags.join(',').length).toBeLessThanOrEqual(500)
    expect(parsed.tags.length).toBeGreaterThan(5)
  })

  it('refuses an answer with no opening', () => {
    expect(() => parseDescriptionAnswer(answer({ body: '  ' }), 2)).toThrow(ValidationError)
  })
})

describe('mockDescription (decision 301)', () => {
  it('is obviously mock, one gloss per chapter, and three hashtags', () => {
    const mocked = mockDescription(3)
    expect(mocked.body).toContain('[mock]')
    expect(mocked.chapterGlosses).toHaveLength(3)
    expect(mocked.hashtags).toHaveLength(3)
  })
})

describe('parseTitleOptions', () => {
  it('parses a clean JSON answer', () => {
    const text = JSON.stringify({ titles: ['How Wirecard Fell', 'Nine Days to Zero'] })
    expect(parseTitleOptions(text)).toEqual(['How Wirecard Fell', 'Nine Days to Zero'])
  })

  it('strips list numbering and wrapping quotes without touching real digits', () => {
    const text = JSON.stringify({
      titles: ['1. How Wirecard Fell', '"Nine Days to Zero"', '9 Days That Ended Wirecard'],
    })
    expect(parseTitleOptions(text)).toEqual([
      'How Wirecard Fell',
      'Nine Days to Zero',
      '9 Days That Ended Wirecard',
    ])
  })

  it('drops overlong titles, dedupes case-insensitively and caps at 10', () => {
    const text = JSON.stringify({
      titles: [
        'x'.repeat(101),
        'How Wirecard Fell',
        'HOW WIRECARD FELL',
        ...Array.from({ length: 12 }, (_, i) => `Title ${i}`),
      ],
    })
    const titles = parseTitleOptions(text)
    expect(titles).toHaveLength(10)
    expect(titles[0]).toBe('How Wirecard Fell')
    expect(titles.filter((t) => t.toLowerCase() === 'how wirecard fell')).toHaveLength(1)
  })

  it('throws when nothing in the answer is usable', () => {
    expect(() => parseTitleOptions(JSON.stringify({ titles: ['x'.repeat(200)] }))).toThrow(
      ValidationError,
    )
    expect(() => parseTitleOptions('no json here at all')).toThrow(ValidationError)
  })
})

describe('mockTitleOptions', () => {
  it('is deterministic, obviously mock, and fills the radio list', () => {
    const titles = mockTitleOptions('Wirecard: The 1.9 Billion Euro Lie')
    expect(titles).toEqual(mockTitleOptions('Wirecard: The 1.9 Billion Euro Lie'))
    expect(titles).toHaveLength(TITLE_OPTION_COUNT)
    for (const title of titles) {
      expect(title.startsWith('[mock]')).toBe(true)
      expect(title.length).toBeLessThanOrEqual(100)
    }
  })
})

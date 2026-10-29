import { describe, expect, it } from 'vitest'
import {
  CHAPTER_GLOSS_MAX,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_IN_USE,
  ValidationError,
} from '@boom-busters/schemas'
import { PSYCHOLOGY_TEST_BIBLE } from './lift/psychology-bible'
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
import type { BibleInUse } from '@boom-busters/schemas'
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
    bible: FIRST_CHANNEL_IN_USE,
    channelName: 'Boom & Busters',
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
      bible: FIRST_CHANNEL_IN_USE,
      channelName: 'Boom & Busters',
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
 * Decision 303: the titles were fed the project's pitch title, which carried
 * "$270M in 18 Months", a figure the dossier flagged as unsourced, and five
 * of eight options repeated it. Titles are now grounded in the claim list.
 */
describe('buildTitlesRequest grounding (decision 303)', () => {
  const grounded = buildTitlesRequest({
    bible: FIRST_CHANNEL_IN_USE,
    channelName: 'Boom & Busters',
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

  it('frames a claim no court has ruled on as an allegation, never a fact (decision 303, review)', () => {
    expect(grounded.system).toMatch(/NOT adjudicated/)
    expect(grounded.system).toMatch(/allegation or a question/)
  })

  it('says the pitch may be wrong and every figure must come from the claims', () => {
    expect(grounded.system).toMatch(/early pitch/)
    expect(grounded.system).toMatch(
      /Every figure, date and name in a title must appear in the claim list/,
    )
  })
})

describe('buildDescriptionRequest (decision 303)', () => {
  const request = buildDescriptionRequest({
    bible: FIRST_CHANNEL_IN_USE,
    channelName: 'Boom & Busters',
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

  it('asks a Short for a few sentences and no chapter glosses', () => {
    const short = buildDescriptionRequest({
      bible: FIRST_CHANNEL_IN_USE,
      channelName: 'Boom & Busters',
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

  /**
   * Every Short was described as the whole case: the claim list led, the
   * film's question came next and the clip's words came last. The clip now
   * leads and the claims follow as a fact check.
   */
  it("writes a Short from what it says, with the film's question left out", () => {
    const short = buildDescriptionRequest({
      bible: FIRST_CHANNEL_IN_USE,
      channelName: 'Boom & Busters',
      target: 'short',
      claims: [CLAIM],
      centralQuestion: 'What was Stability AI giving away, and what did it keep?',
      chapters: [],
      shortText: '[pause] The method was not Stability AI’s. It came from a lab in Munich.',
    })
    expect(short.messages[0]?.content).toMatch(/^What this Short says:\nThe method was not/)
    expect(short.messages[1]?.content).toMatch(/^Claims, for checking facts only:/)
    const content = short.messages.map((m) => m.content).join('\n')
    expect(content).not.toContain('What was Stability AI giving away')
    expect(content).not.toContain('[pause]')
    expect(short.system).toMatch(/about what this\s+Short says rather than the whole case/)
    expect(short.system).toMatch(/full documentary is on the channel/)
  })
})

describe('buildTitlesRequest for a Short (decision 303)', () => {
  const clip = buildTitlesRequest({
    bible: FIRST_CHANNEL_IN_USE,
    channelName: 'Boom & Busters',
    caseTitle: 'Stability AI',
    hook: 'March 2024. Emad Mostaque resigned.',
    target: 'short',
    workingTitle: 'The Borrowed Engine',
    claims: [CLAIM],
    centralQuestion: 'What was Stability AI giving away, and what did it keep?',
    shortText: 'The method was not Stability AI’s. It came from a lab in Munich.',
  })

  it("writes from what the Short says, not the film's hook or question", () => {
    const content = clip.messages.map((m) => m.content).join('\n')
    expect(content).toContain('What this Short says:\nThe method was not Stability AI’s.')
    expect(content).not.toContain('Emad Mostaque resigned')
    expect(content).not.toContain('What was Stability AI giving away')
    expect(content).toContain('Claims, for checking facts only:')
    expect(clip.system).toMatch(/about what this Short says, not the whole film/)
  })

  it('keeps the film framing for a Short whose narration could not be read', () => {
    const unread = buildTitlesRequest({
      bible: FIRST_CHANNEL_IN_USE,
      channelName: 'Boom & Busters',
      caseTitle: 'Stability AI',
      hook: 'March 2024. Emad Mostaque resigned.',
      target: 'short',
      workingTitle: 'The Borrowed Engine',
      claims: [CLAIM],
    })
    expect(unread.messages.map((m) => m.content).join('\n')).toContain('Emad Mostaque resigned')
    expect(unread.system).not.toMatch(/not the whole film/)
  })
})

describe('parseDescriptionAnswer (decision 303)', () => {
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

  it('drops a hashtag too long to store, and flattens a gloss onto one line', () => {
    const parsed = parseDescriptionAnswer(
      answer({
        hashtags: ['#' + 'x'.repeat(70), '#StabilityAI'],
        chapterGlosses: ['Two lines\nof gloss', 'ok'],
      }),
      2,
    )
    expect(parsed.hashtags).toEqual(['#StabilityAI'])
    expect(parsed.chapterGlosses[0]).toBe('Two lines of gloss')
  })

  it('refuses an answer with no opening', () => {
    expect(() => parseDescriptionAnswer(answer({ body: '  ' }), 2)).toThrow(ValidationError)
  })
})

describe('mockDescription (decision 303)', () => {
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

describe('metadata prompts read the channel bible', () => {
  const psychology = { bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS }
  const titles = buildTitlesRequest({
    bible: psychology,
    channelName: 'Mind Matters',
    caseTitle: 'The Stanford prison experiment',
    hook: 'In August 1971, a basement became a prison.',
    target: 'master',
    workingTitle: 'The Stanford prison experiment',
  })
  const description = buildDescriptionRequest({
    bible: psychology,
    channelName: 'Mind Matters',
    target: 'master',
    claims: [CLAIM],
    chapters: [],
  })

  it('names the channel from its row and the style from the bible', () => {
    expect(titles.system).toContain('You write YouTube titles for Mind Matters, a documentary')
    expect(titles.system).toContain(`${PSYCHOLOGY_TEST_BIBLE.titleStyle} —`)
    expect(titles.system).toContain('Name the idea or person;')
    expect(description.system).toContain('YouTube descriptions for Mind Matters, a documentary')
    expect(titles.system).not.toContain('Boom & Busters')
    expect(description.system).not.toContain('Boom & Busters')
  })

  it("takes each slot from the channel's own examples", () => {
    expect(titles.system).toContain(PSYCHOLOGY_TEST_BIBLE.examples['metadata-title-mechanisms']!)
    expect(description.system).toContain(
      PSYCHOLOGY_TEST_BIBLE.examples['metadata-description-opening']!,
    )
    expect(description.system).toContain(PSYCHOLOGY_TEST_BIBLE.examples['metadata-tag-kinds']!)
  })

  it('sends owner-typed text exactly as typed, even when it looks like a marker', () => {
    const typed = {
      ...FIRST_CHANNEL_IN_USE,
      bible: { ...FIRST_CHANNEL_IN_USE.bible, titleStyle: 'Plain [[example:nope]] words' },
    }
    const request = buildTitlesRequest({
      bible: typed,
      channelName: 'Odd [[if:x]] Name',
      caseTitle: 'Wirecard',
      hook: 'Hook.',
      target: 'master',
      workingTitle: 'Wirecard',
    })
    expect(request.system).toContain('Plain [[example:nope]] words —')
    expect(request.system).toContain('titles for Odd [[if:x]] Name,')
  })
})

describe("buildTitlesRequest with the channel's drafted titles", () => {
  const input = {
    channelName: 'Boom & Busters',
    caseTitle: 'Wirecard',
    hook: 'Hook.',
    target: 'master' as const,
    workingTitle: 'Wirecard',
  }
  const drafted = {
    ...FIRST_CHANNEL_IN_USE,
    bible: {
      ...FIRST_CHANNEL_IN_USE.bible,
      titles: [
        { text: 'The Vault Was Empty', note: 'states the loss', drawnFrom: [] },
        { text: 'Who Checked? [[example:x]]', note: '', drawnFrom: [] },
      ],
    },
  }

  it('lists them after the existing rules, text verbatim', () => {
    const { system } = buildTitlesRequest({ ...input, bible: drafted })
    expect(system).toContain('- The Vault Was Empty (states the loss)')
    expect(system).toContain('- Who Checked? [[example:x]]')
    expect(system.indexOf("The channel's own titles")).toBeGreaterThan(
      system.indexOf('the stakes must be in the first half.'),
    )
  })

  it('adds nothing when the channel has none', () => {
    const { system } = buildTitlesRequest({ ...input, bible: FIRST_CHANNEL_IN_USE })
    expect(system).not.toContain("The channel's own titles")
  })
})

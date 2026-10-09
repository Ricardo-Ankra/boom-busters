import {
  CASE_ANGLE_MAX,
  CASE_DEMAND_NOTES_MAX,
  CASE_LINK_NOTE_MAX,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildSuggestCasesRequest,
  fileCaseRepairs,
  mockSuggestedCases,
  parseSuggestedCases,
} from './cases'
import type { Note, Repair } from './repair'

const valid = JSON.stringify({
  suggestions: [
    {
      title: 'Wirecard',
      category: 'con',
      angle: 'The auditor sign-offs are the story, not the missing billion.',
      demandNotes: 'Sustained search interest since the 2020 collapse.',
      competitorLinks: [{ url: 'https://example.com/video', note: 'surface level' }],
      priorityScore: 88,
    },
  ],
})

describe('buildSuggestCasesRequest', () => {
  it('routes at the research task', () => {
    expect(buildSuggestCasesRequest({ existingTitles: [], count: 5 }).task).toBe('research')
  })

  it('lists what is already in the library so it is not proposed again', () => {
    const request = buildSuggestCasesRequest({ existingTitles: ['Enron', 'Theranos'], count: 3 })

    expect(request.messages[0]?.content).toContain('Enron')
    expect(request.messages[0]?.content).toContain('Theranos')
    expect(request.messages[0]?.content).toContain('do not propose these again')
  })

  it('omits the exclusion list entirely for an empty library', () => {
    expect(
      buildSuggestCasesRequest({ existingTitles: [], count: 3 }).messages[0]?.content,
    ).not.toContain('do not propose')
  })

  it('passes the human steer through', () => {
    const request = buildSuggestCasesRequest({ existingTitles: [], count: 3, steer: 'aviation' })
    expect(request.messages[0]?.content).toContain('aviation')
  })

  it('ignores a steer that is only whitespace', () => {
    const request = buildSuggestCasesRequest({ existingTitles: [], count: 3, steer: '   ' })
    expect(request.messages[0]?.content).not.toContain('asks specifically')
  })

  it('scales the token budget with the count, with room to think, but caps it', () => {
    expect(buildSuggestCasesRequest({ existingTitles: [], count: 3 }).maxTokens).toBeLessThan(
      buildSuggestCasesRequest({ existingTitles: [], count: 10 }).maxTokens,
    )
    // Capped, so a silly count cannot ask for an unbounded completion.
    expect(buildSuggestCasesRequest({ existingTitles: [], count: 100 }).maxTokens).toBe(32_000)
  })

  it('tells the model not to invent cases', () => {
    const { system } = buildSuggestCasesRequest({ existingTitles: [], count: 1 })
    expect(system).toMatch(/Never invent/)
    expect(system).toMatch(/real, documented events/)
  })
})

describe('parseSuggestedCases', () => {
  it('reads a clean answer', () => {
    const [suggestion] = parseSuggestedCases(valid)
    expect(suggestion?.title).toBe('Wirecard')
    expect(suggestion?.priorityScore).toBe(88)
  })

  it('reads an answer wrapped in a code fence and prose', () => {
    expect(parseSuggestedCases(`Sure!\n\`\`\`json\n${valid}\n\`\`\`\nLet me know.`)).toHaveLength(1)
  })

  it('rejects a category the data model does not have', () => {
    const bad = valid.replace('"con"', '"scandal"')
    // An invented category cannot be inserted, so it has to fail here rather
    // than at the database with a constraint violation.
    expect(() => parseSuggestedCases(bad)).toThrow(ValidationError)
  })

  it('rejects a competitor link that is not a URL', () => {
    expect(() =>
      parseSuggestedCases(valid.replace('https://example.com/video', 'see YouTube')),
    ).toThrow(ValidationError)
  })

  it('rejects an empty suggestion list rather than showing an empty table', () => {
    expect(() => parseSuggestedCases('{"suggestions":[]}')).toThrow(ValidationError)
  })

  it('survives a missing optional field', () => {
    const minimal = JSON.stringify({
      suggestions: [
        { title: 'Enron', category: 'collapse', angle: 'a'.repeat(20), priorityScore: 50 },
      ],
    })
    expect(parseSuggestedCases(minimal)).toHaveLength(1)
  })
})

describe('mockSuggestedCases', () => {
  it('says in every title that it is not a real case', () => {
    // These get accepted into the library during a demo and researched for
    // real weeks later by someone who has forgotten where they came from.
    for (const suggestion of mockSuggestedCases(5)) {
      expect(suggestion.title).toMatch(/mock/i)
      expect(suggestion.title).toMatch(/not a real case/)
    }
  })

  it('produces exactly what was asked for, and validates', () => {
    const suggestions = mockSuggestedCases(7)
    expect(suggestions).toHaveLength(7)
    expect(() =>
      parseSuggestedCases(JSON.stringify({ suggestions: suggestions.slice(0, 20) })),
    ).not.toThrow()
  })

  it('is deterministic', () => {
    expect(mockSuggestedCases(4)).toEqual(mockSuggestedCases(4))
  })
})

describe("a suggestion's limits (decision 293)", () => {
  const wirecard = (): Record<string, unknown> => JSON.parse(valid).suggestions[0]
  const answer = (...suggestions: Record<string, unknown>[]) => JSON.stringify({ suggestions })
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('states every limit in the prompt', () => {
    const { system } = buildSuggestCasesRequest({ existingTitles: [], count: 4 })
    expect(system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): title 3 to 200 characters; angle 10 to 2000 characters; ' +
        'demandNotes at most 2000 characters; at most 10 competitorLinks, each note at most 500 ' +
        'characters; priorityScore a whole number from 0 to 100; no more cases than asked for.',
    )
  })

  it('trims free text over its limit at a sentence, names the case, and leaves the facts alone', () => {
    const { notes, note } = collect()
    const long = {
      ...wirecard(),
      angle: 'The auditors signed off for a decade. '.repeat(60),
      demandNotes: 'Search interest held for years. '.repeat(70),
      competitorLinks: [
        { url: 'https://example.com/a', note: 'surface level' },
        { url: 'https://example.com/b', note: 'Covers the raid only. '.repeat(30) },
      ],
    }
    const [parsed] = parseSuggestedCases(answer(long), 8, note)
    expect(parsed!.angle.length).toBeLessThanOrEqual(CASE_ANGLE_MAX)
    expect(parsed!.angle.endsWith('The auditors signed off for a decade.')).toBe(true)
    expect(parsed!.demandNotes!.length).toBeLessThanOrEqual(CASE_DEMAND_NOTES_MAX)
    expect(parsed!.competitorLinks![1]!.note!.length).toBeLessThanOrEqual(CASE_LINK_NOTE_MAX)
    expect(parsed).toMatchObject({ title: 'Wirecard', category: 'con', priorityScore: 88 })
    expect(parsed!.competitorLinks!.map((link) => link.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the angle of Wirecard' },
      { action: 'trimmed', field: 'the demand notes of Wirecard' },
      { action: 'trimmed', field: 'the note on link 2 of Wirecard' },
    ])
  })

  it('keeps the first 10 competitor links', () => {
    const { notes, note } = collect()
    const links = Array.from({ length: 12 }, (_, at) => ({ url: `https://example.com/${at + 1}` }))
    const [parsed] = parseSuggestedCases(answer({ ...wirecard(), competitorLinks: links }), 8, note)
    expect(parsed!.competitorLinks).toHaveLength(10)
    expect(parsed!.competitorLinks![9]!.url).toBe('https://example.com/10')
    expect(notes).toEqual([{ action: 'capped', field: 'competitor links of Wirecard', kept: 10 }])
  })

  it("rounds a fractional priority score and holds the scale's ends, with a note", () => {
    const { notes, note } = collect()
    const parsed = parseSuggestedCases(
      answer(
        { ...wirecard(), priorityScore: 9.5 },
        { ...wirecard(), title: 'Theranos', priorityScore: 1000 },
        { ...wirecard(), title: 'Enron', priorityScore: -3 },
      ),
      8,
      note,
    )
    expect(parsed.map((suggestion) => suggestion.priorityScore)).toEqual([10, 100, 0])
    expect(notes).toEqual([
      { action: 'rounded', field: 'the priority score of Wirecard', from: 9.5, to: 10 },
      { action: 'rounded', field: 'the priority score of Theranos', from: 1000, to: 100 },
      { action: 'rounded', field: 'the priority score of Enron', from: -3, to: 0 },
    ])
  })

  it('still refuses a priority score that is not a number', () => {
    expect(() => parseSuggestedCases(answer({ ...wirecard(), priorityScore: 'high' }))).toThrow(
      /priorityScore/,
    )
  })

  it('drops a suggestion whose title runs over 200 characters and keeps the rest', () => {
    const { notes, note } = collect()
    const title = `The ${'very '.repeat(50)}long case`
    const parsed = parseSuggestedCases(answer(wirecard(), { ...wirecard(), title }), 8, note)
    expect(parsed.map((suggestion) => suggestion.title)).toEqual(['Wirecard'])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: `suggestion 2 ("The${' very'.repeat(11)}...")`,
        reason: 'its title ran over 200 characters',
      },
    ])
  })

  it('keeps no more suggestions than were asked for', () => {
    const { notes, note } = collect()
    const parsed = parseSuggestedCases(
      answer(wirecard(), { ...wirecard(), title: 'Theranos' }, { ...wirecard(), title: 'Enron' }),
      2,
      note,
    )
    expect(parsed.map((suggestion) => suggestion.title)).toEqual(['Wirecard', 'Theranos'])
    expect(notes).toEqual([{ action: 'capped', field: 'suggestions', kept: 2 }])
  })

  it('refuses an answer left with no suggestion once the drops are made', () => {
    expect(() => parseSuggestedCases(answer({ ...wirecard(), title: 'x'.repeat(201) }))).toThrow(
      ValidationError,
    )
  })

  it('files each repair under its own case, the longer of two titles that end alike first', () => {
    const repairs: Repair[] = [
      { action: 'trimmed', field: 'the angle of Bank of Credit and Commerce International' },
      { action: 'trimmed', field: 'the angle of Credit and Commerce International' },
      { action: 'rounded', field: 'the priority score of Wirecard', from: 9.5, to: 10 },
      {
        action: 'dropped',
        field: 'suggestion 4 ("A title...")',
        reason: 'its title ran over 200 characters',
      },
      { action: 'capped', field: 'suggestions', kept: 3 },
    ]
    const filed = fileCaseRepairs(repairs, [
      'Credit and Commerce International',
      'Bank of Credit and Commerce International',
      'Wirecard',
    ])
    expect(filed.byTitle.get('Bank of Credit and Commerce International')).toEqual([repairs[0]])
    expect(filed.byTitle.get('Credit and Commerce International')).toEqual([repairs[1]])
    expect(filed.byTitle.get('Wirecard')).toEqual([repairs[2]])
    expect(filed.rest).toEqual([repairs[3], repairs[4]])
  })
})

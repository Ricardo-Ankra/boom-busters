import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildSuggestCasesRequest, mockSuggestedCases, parseSuggestedCases } from './cases'

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

  it('scales the token budget with the count but caps it', () => {
    expect(buildSuggestCasesRequest({ existingTitles: [], count: 3 }).maxTokens).toBeLessThan(
      buildSuggestCasesRequest({ existingTitles: [], count: 10 }).maxTokens,
    )
    expect(buildSuggestCasesRequest({ existingTitles: [], count: 100 }).maxTokens).toBe(8000)
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

  it('rejects a priority score outside 0-100', () => {
    expect(() => parseSuggestedCases(valid.replace('88', '1000'))).toThrow(/priorityScore/)
  })

  it('rejects a non-integer priority score', () => {
    expect(() => parseSuggestedCases(valid.replace('88', '9.5'))).toThrow(ValidationError)
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

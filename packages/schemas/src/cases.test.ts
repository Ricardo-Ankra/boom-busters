import { describe, expect, it } from 'vitest'
import {
  CASE_PEOPLE_MAX,
  CASE_PERSON_MAX,
  CASE_SUBJECT_MAX,
  CASE_SUBJECT_MIN,
  CaseSuggestionSchema,
} from './cases'

const base = {
  title: 'The Auditors Who Signed It Off',
  category: 'con',
  angle: 'A story about the audit that never looked.',
  priorityScore: 80,
  subject: 'Wirecard',
}

describe('CaseSuggestionSchema subject and people', () => {
  it('parses a subject and defaults people to empty', () => {
    const parsed = CaseSuggestionSchema.parse(base)
    expect(parsed.subject).toBe('Wirecard')
    expect(parsed.people).toEqual([])
  })

  it('requires a subject', () => {
    const { subject: _subject, ...rest } = base
    expect(CaseSuggestionSchema.safeParse(rest).success).toBe(false)
  })

  it('enforces the subject limits and trims', () => {
    expect(
      CaseSuggestionSchema.safeParse({ ...base, subject: 'x'.repeat(CASE_SUBJECT_MIN - 1) })
        .success,
    ).toBe(false)
    expect(
      CaseSuggestionSchema.safeParse({ ...base, subject: 'x'.repeat(CASE_SUBJECT_MAX + 1) })
        .success,
    ).toBe(false)
    expect(CaseSuggestionSchema.parse({ ...base, subject: '  Enron  ' }).subject).toBe('Enron')
  })

  it('enforces the people limits', () => {
    const ok = CaseSuggestionSchema.parse({ ...base, people: ['Markus Braun', 'Jan Marsalek'] })
    expect(ok.people).toHaveLength(2)
    const tooMany = Array.from({ length: CASE_PEOPLE_MAX + 1 }, (_, i) => `Person ${i}`)
    expect(CaseSuggestionSchema.safeParse({ ...base, people: tooMany }).success).toBe(false)
    expect(
      CaseSuggestionSchema.safeParse({ ...base, people: ['x'.repeat(CASE_PERSON_MAX + 1)] })
        .success,
    ).toBe(false)
    expect(CaseSuggestionSchema.safeParse({ ...base, people: ['A'] }).success).toBe(false)
  })
})

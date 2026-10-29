import {
  CASE_PEOPLE_MAX,
  CASE_SUBJECT_MAX,
  FIRST_CHANNEL_IN_USE,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildNameSubjectRequest, mockNameSubject, parseNameSubject } from './subject'
import type { Repair } from './repair'

describe('buildNameSubjectRequest', () => {
  const request = buildNameSubjectRequest({
    bible: FIRST_CHANNEL_IN_USE,
    title: 'Wirecard and the missing billion',
    angle: 'The auditor sign-offs are the story.',
    category: 'con',
  })

  it('routes at the cheap digest task and asks for JSON', () => {
    expect(request.task).toBe('digest')
    expect(request.system).toContain('{"subject": string, "people": [string]}')
  })

  it('carries the two rules and the case', () => {
    expect(request.system).toContain('common name as Wikipedia titles it')
    expect(request.system).toContain(`at most ${CASE_PEOPLE_MAX}`)
    expect(request.messages[0]?.content).toContain('Wirecard and the missing billion')
    expect(request.messages[0]?.content).toContain('auditor sign-offs')
  })

  it('leaves out an angle the case does not have', () => {
    const bare = buildNameSubjectRequest({
      bible: FIRST_CHANNEL_IN_USE,
      title: 'Enron',
      angle: null,
      category: 'collapse',
    })
    expect(bare.messages[0]?.content).not.toContain('Angle')
  })
})

describe('parseNameSubject', () => {
  it('reads the subject and people', () => {
    expect(
      parseNameSubject('{"subject": "Wirecard", "people": ["Markus Braun", "Jan Marsalek"]}'),
    ).toEqual({ subject: 'Wirecard', people: ['Markus Braun', 'Jan Marsalek'] })
  })

  it('cuts a subject that comes back as a sentence to the limit, with a note', () => {
    const sentence = `${'Wirecard was a German payments company that collapsed. '.repeat(5)}`
    const repairs: Repair[] = []
    const { subject } = parseNameSubject(JSON.stringify({ subject: sentence, people: [] }), (r) =>
      repairs.push(r),
    )
    expect(subject.length).toBeLessThanOrEqual(CASE_SUBJECT_MAX)
    expect(repairs).toContainEqual({ action: 'trimmed', field: 'the subject' })
  })

  it('caps the people with a note', () => {
    const people = Array.from({ length: CASE_PEOPLE_MAX + 2 }, (_, i) => `Person ${i}`)
    const repairs: Repair[] = []
    const parsed = parseNameSubject(JSON.stringify({ subject: 'Wirecard', people }), (r) =>
      repairs.push(r),
    )
    expect(parsed.people).toHaveLength(CASE_PEOPLE_MAX)
    expect(repairs).toContainEqual({ action: 'capped', field: 'people', kept: CASE_PEOPLE_MAX })
  })

  it('defaults missing people to none', () => {
    expect(parseNameSubject('{"subject": "Wirecard"}').people).toEqual([])
  })

  it('refuses a missing subject', () => {
    expect(() => parseNameSubject('{"people": []}')).toThrow(ValidationError)
  })
})

describe('mockNameSubject', () => {
  it('uses the text before the first colon', () => {
    expect(mockNameSubject('Wirecard: the missing billion')).toEqual({
      subject: 'Wirecard',
      people: [],
    })
  })

  it('uses the whole title when there is no colon', () => {
    expect(mockNameSubject('Enron')).toEqual({ subject: 'Enron', people: [] })
  })
})

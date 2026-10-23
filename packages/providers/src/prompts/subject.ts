import {
  CASE_PEOPLE_MAX,
  CASE_SUBJECT_MAX,
  CASE_SUBJECT_MIN,
  CaseSuggestionSchema,
  ValidationError,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * Naming the subject of a case saved before cases carried one. One cheap call
 * (the `digest` route), made the first time the dossier runs and stored on
 * the case, so it is never asked again. The two rules are those of the
 * suggestion prompt, in the same words.
 */

const SYSTEM = `You name the subject of a case study for a YouTube channel about
corporate collapses, frauds, meltdowns and turnarounds. You are given the
case's working title, its category and its angle.

Rules:
- Only real, documented events. Never invent a company, a person or a figure.
- \`subject\` is the company's common name as Wikipedia titles it, nothing else; \`people\` are the main people, at most ${CASE_PEOPLE_MAX}, full names.

Limit (the app checks it): subject ${CASE_SUBJECT_MIN} to ${CASE_SUBJECT_MAX} characters.

Answer with JSON only, no prose around it:
{"subject": string, "people": [string]}`

export function buildNameSubjectRequest(input: {
  title: string
  angle: string | null
  category: string
}): LLMTaskRequest {
  const angle = input.angle?.trim() ? `\nAngle: ${input.angle.trim()}` : ''
  return {
    task: 'digest',
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Title: ${input.title}\nCategory: ${input.category}${angle}`,
      },
    ],
    maxTokens: outputBudget(200),
  }
}

export interface NamedSubject {
  subject: string
  people: string[]
}

const Envelope = z.looseObject({})

const NamedSubjectSchema = CaseSuggestionSchema.pick({ subject: true, people: true })

/** The answer repaired as the suggestion prompt's is: a long subject cut with a note, people capped. */
export function parseNameSubject(text: string, note: Note = ignoreRepairs): NamedSubject {
  const raw = parseJsonCompletion(text, Envelope, 'case subject')
  const parsed = NamedSubjectSchema.safeParse({
    ...raw,
    subject: trimField(raw['subject'], CASE_SUBJECT_MAX, 'the subject', note),
    ...(raw['people'] === undefined
      ? {}
      : { people: capList(raw['people'], CASE_PEOPLE_MAX, 'people', note) }),
  })
  if (!parsed.success) {
    throw new ValidationError(`The case subject is malformed: ${formatIssues(parsed.error)}`, {
      field: 'case subject',
    })
  }
  return parsed.data
}

/** Deterministic stand-in for `MOCK_PROVIDERS=1`: the title up to its first colon. */
export function mockNameSubject(title: string): NamedSubject {
  const head = title.split(':')[0]?.trim()
  return { subject: head || title, people: [] }
}

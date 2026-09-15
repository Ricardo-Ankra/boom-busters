import { describe, expect, it } from 'vitest'
import { buildDirectorsBookRequest, mockDirectorsBook, parseDirectorsBook } from './direction'
import type { ScriptClaim } from './script'

const CLAIMS: ScriptClaim[] = [
  {
    id: '01HQ00000000000000000000AA',
    text: 'Markus Braun was chief executive of Wirecard from 2002 to June 2020.',
    sourceUrl: 'https://example.com/braun',
    confidence: 'sourced',
  },
]

const CHAPTERS = [
  {
    title: 'The glass box',
    paragraphs: ['A company that looked solid.'],
    question: 'Where was the cash?',
    withhold: 'The Manila trustee',
  },
  {
    title: 'The missing billions',
    paragraphs: ['By June, the auditors could not find the money.'],
  },
]

describe('buildDirectorsBookRequest', () => {
  const request = buildDirectorsBookRequest({
    caseTitle: 'Wirecard',
    centralQuestion: 'How did two billion euros never exist?',
    chapters: CHAPTERS,
    claims: CLAIMS,
    styleAnchors: 'subtle film grain; muted grade',
  })

  it('routes to the direction task', () => {
    expect(request.task).toBe('direction')
  })

  it('carries the bible in the system prompt', () => {
    expect(request.system).toContain('# Direction craft')
    expect(request.system).toContain('exactly three recurring visual motifs')
  })

  it('shows the outline tension fields and numbers the chapters from 1', () => {
    const body = request.messages.map((message) => message.content).join('\n')
    expect(body).toContain('Central question: How did two billion euros never exist?')
    expect(body).toContain('Chapter 1: The glass box')
    expect(body).toContain('Withholds: The Manila trustee')
    expect(body).toContain('Chapter 2: The missing billions')
  })

  it('makes the claim list the cacheable prefix', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('Markus Braun was chief executive')
  })

  it('makes likeness the default and keeps guardrails to defamation and mockery', () => {
    expect(request.system).toContain('every one of them is\n  "likeness"')
    expect(request.system).toContain('Never choose "archival-only" yourself')
    expect(request.system).toContain('never keeps them away from desks')
    expect(request.system).toContain('begins with the full name and role')
  })

  it('asks for a face in the identity string, not a job title', () => {
    expect(request.system).toContain('face shape, hair, beard or none')
    expect(request.system).toContain('a job title and a jacket')
  })

  it('threads the Brand Kit anchors in as the palette boundary', () => {
    expect(request.system).toContain('subtle film grain; muted grade')
  })

  it('gives a longer film a bigger answer budget: one chapter entry per chapter', () => {
    const eight = buildDirectorsBookRequest({
      caseTitle: 'Wirecard',
      chapters: Array.from({ length: 8 }, (_, index) => ({
        title: `Chapter ${index + 1}`,
        paragraphs: ['Words.'],
      })),
      claims: CLAIMS,
      styleAnchors: 'a',
    })
    expect(eight.maxTokens).toBeGreaterThan(request.maxTokens)
  })
})

describe('buildDirectorsBookRequest with a cast (decision 253)', () => {
  const cast = [
    {
      name: 'Emad Mostaque',
      role: 'Founder and former CEO, Stability AI',
      identityString: 'Emad Mostaque, founder: oval face, short dark hair, close-cropped beard',
    },
  ]
  const request = buildDirectorsBookRequest({
    caseTitle: 'Stability AI',
    chapters: CHAPTERS,
    claims: CLAIMS,
    styleAnchors: 'a',
    cast,
  })

  it('lists the cast ahead of the chapters and requires each as a likeness principal', () => {
    const body = request.messages[1]?.content ?? ''
    expect(body.startsWith('Cast, already photographed')).toBe(true)
    expect(body).toContain('- Emad Mostaque, Founder and former CEO, Stability AI. Identity: Emad')
    expect(request.system).toContain('never drop a cast member')
  })

  it('says nothing about a cast when there is none', () => {
    const bare = buildDirectorsBookRequest({
      caseTitle: 'x',
      chapters: CHAPTERS,
      claims: CLAIMS,
      styleAnchors: 'a',
    })
    expect(bare.messages[1]?.content).not.toContain('Cast, already photographed')
  })

  it('mocks the cast as likeness principals with the exact names', () => {
    const book = mockDirectorsBook({ caseTitle: 'x', chapterCount: 2, cast })
    expect(book.principals[0]).toMatchObject({
      name: 'Emad Mostaque',
      depiction: 'likeness',
      identityString: cast[0]!.identityString,
    })
  })
})

describe('parseDirectorsBook', () => {
  it('parses a fenced completion and checks chapter numbers', () => {
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
    const parsed = parseDirectorsBook('```json\n' + JSON.stringify(book) + '\n```', 2)
    expect(parsed.motifs).toHaveLength(3)
  })

  it('refuses a book whose chapters do not match the script', () => {
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
    expect(() => parseDirectorsBook(JSON.stringify(book), 3)).toThrow(/chapter/)
  })

  it('refuses a malformed book with the field named', () => {
    const book = {
      ...mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1 }),
      motifs: ['one'],
    }
    expect(() => parseDirectorsBook(JSON.stringify(book), 1)).toThrow(/motifs/)
  })
})

describe('mockDirectorsBook', () => {
  it('is deterministic, valid, and one chapter entry per chapter', () => {
    const a = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 3 })
    const b = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 3 })
    expect(a).toEqual(b)
    expect(a.chapters.map((chapter) => chapter.chapter)).toEqual([1, 2, 3])
    expect(a.principals[0]?.depiction).toBe('anonymous')
  })
})

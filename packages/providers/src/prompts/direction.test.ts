import { BOOK_TEXT_MAX } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildDirectorsBookRequest,
  mockDirectorsBook,
  parseDirectorsBook,
  repairDirectorsBook,
} from './direction'
import { describeRepairs } from './repair'
import type { Note, Repair } from './repair'
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
  })

  it('routes to the direction task', () => {
    expect(request.task).toBe('direction')
  })

  it('carries the bible in the system prompt', () => {
    expect(request.system).toContain('# Direction craft')
    expect(request.system).toContain('exactly three recurring visual motifs')
  })

  it('says how to choose motifs: this story, never the house furniture (decision 260)', () => {
    expect(request.system).toContain('Motifs are this story')
    expect(request.system).toContain('never the house look')
    expect(request.system).toContain('could belong to any corporate collapse')
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

  it("gives the palette temperature as the film's light, never a grade or hex code", () => {
    expect(request.system).toContain("The palette's temperature is the film's light")
    expect(request.system).not.toContain('Brand Kit grade')
  })

  it('gives a longer film a bigger answer budget: one chapter entry per chapter', () => {
    const eight = buildDirectorsBookRequest({
      caseTitle: 'Wirecard',
      chapters: Array.from({ length: 8 }, (_, index) => ({
        title: `Chapter ${index + 1}`,
        paragraphs: ['Words.'],
      })),
      claims: CLAIMS,
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

describe('the book cannot converge on one symbol (decision 271)', () => {
  const request = buildDirectorsBookRequest({
    caseTitle: 'Stability AI',
    chapters: [{ title: 'The exit', paragraphs: ['He is gone.'] }],
    claims: [],
  })

  it('keeps the anchor object out of the motifs, and the motifs apart', () => {
    expect(request.system).toContain('The anchor object is one object the film returns to')
    expect(request.system).toContain('sharing no head noun with each other or with the')
  })

  it('puts people in the thesis and in the key images', () => {
    expect(request.system).toContain('including its people')
    expect(request.system).toContain('describes how the film looks with its people in it')
    expect(request.system).toContain('led by the people and place the claims name for it')
  })

  it('keeps an era lock off the subject of a frame', () => {
    expect(request.system).toContain('Era locks constrain what a frame may contain')
  })
})

describe("the book's limits (decision 292)", () => {
  const book = () =>
    JSON.parse(JSON.stringify(mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 })))

  it('states every limit in the prompt', () => {
    const rules = buildDirectorsBookRequest({
      caseTitle: 'x',
      chapters: [{ title: 'The audit', paragraphs: ['A paragraph.'] }],
      claims: [],
    }).system.replace(/\s+/g, ' ')
    expect(rules).toContain(
      'every text value at most 600 characters; 1 to 6 era locks; exactly 3 motifs; at most 12 never-shows, 12 principals and 12 locations; one chapter entry per chapter, numbered as given',
    )
  })

  it('trims an era rule over the limit at a sentence instead of refusing the book', () => {
    // The owner's failed redraft (2026-10-08): era rules past 600 characters.
    const answer = book()
    answer.eraLocks[0].rules = 'CRT monitors on every desk. '.repeat(30)
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1)
    expect(parsed.eraLocks[0]!.rules.length).toBeLessThanOrEqual(BOOK_TEXT_MAX)
    expect(parsed.eraLocks[0]!.rules.endsWith('CRT monitors on every desk.')).toBe(true)
  })

  it('keeps the first items of a list over its cap, and the first three of four motifs', () => {
    const answer = book()
    answer.neverShow = Array.from({ length: 14 }, (_, at) => `exclusion ${at}`)
    answer.motifs = ['the badge', 'the server rack', 'the term sheet', 'the logo']
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1)
    expect(parsed.neverShow).toHaveLength(12)
    expect(parsed.neverShow[11]).toBe('exclusion 11')
    expect(parsed.motifs).toEqual(['the badge', 'the server rack', 'the term sheet'])
  })

  it('never trims a name, and still refuses two motifs and wrong chapter numbering', () => {
    const named = book()
    named.principals[0].name = 'N'.repeat(BOOK_TEXT_MAX + 1)
    expect(() => parseDirectorsBook(JSON.stringify(named), 1)).toThrow(/malformed/)

    const twoMotifs = book()
    twoMotifs.motifs = ['the badge', 'the server rack']
    expect(() => parseDirectorsBook(JSON.stringify(twoMotifs), 1)).toThrow(/malformed/)

    const renumbered = book()
    renumbered.chapters[0].chapter = 2
    expect(() => parseDirectorsBook(JSON.stringify(renumbered), 1)).toThrow(/covers chapters/)
  })
})

describe("the book's repairs, in the owner's words (decision 293)", () => {
  const book = () =>
    JSON.parse(JSON.stringify(mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 })))
  const long = 'A sentence about the period that runs on. '.repeat(20)
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('names each trimmed text the way the Direction card does', () => {
    const answer = book()
    answer.visualThesis = long
    answer.eraLocks = [
      { span: '1995 to 2008', rules: 'CRT monitors on every desk.' },
      { span: '2008 to 2020', rules: long },
    ]
    answer.palette.note = long
    answer.anchorObject = long
    answer.finalImage = long
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the visual thesis' },
      { action: 'trimmed', field: 'era rule 2' },
      { action: 'trimmed', field: 'the palette note' },
      { action: 'trimmed', field: 'the anchor object' },
      { action: 'trimmed', field: 'the final image' },
    ])
  })

  it('reports each cap, and numbers what it trims as the model wrote the list', () => {
    const answer = book()
    answer.eraLocks = Array.from({ length: 7 }, (_, at) => ({
      span: `${1990 + at}`,
      rules: 'Pagers on every belt.',
    }))
    answer.motifs = ['the badge', long, 'the term sheet', 'the logo']
    answer.neverShow = [long, ...Array.from({ length: 12 }, (_, at) => `exclusion ${at}`)]
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'capped', field: 'era locks', kept: 6 },
      { action: 'capped', field: 'motifs', kept: 3 },
      { action: 'trimmed', field: 'motif 2' },
      { action: 'capped', field: 'never-shows', kept: 12 },
      { action: 'trimmed', field: 'never-show 1' },
    ])
  })

  it("names a person's and a place's fields by name, and a chapter's by its number", () => {
    const answer = book()
    answer.principals = [
      {
        name: 'Emad Mostaque',
        role: long,
        depiction: 'likeness',
        identityString: long,
        guardrail: long,
      },
      ...Array.from({ length: 12 }, (_, at) => ({
        name: `Person ${at}`,
        role: 'Director',
        depiction: 'anonymous',
        identityString: 'A face.',
        guardrail: 'Never mocked.',
      })),
    ]
    answer.locations = [
      { name: 'The Server Hall', look: long },
      ...Array.from({ length: 12 }, (_, at) => ({ name: `Room ${at}`, look: 'A room.' })),
    ]
    answer.chapters[0].moodShift = long
    answer.chapters[0].keyImage = long
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'capped', field: 'principals', kept: 12 },
      { action: 'trimmed', field: "Emad Mostaque's role" },
      { action: 'trimmed', field: "Emad Mostaque's identity" },
      { action: 'trimmed', field: "Emad Mostaque's guardrail" },
      { action: 'capped', field: 'locations', kept: 12 },
      { action: 'trimmed', field: "The Server Hall's look" },
      { action: 'trimmed', field: "chapter 1's mood shift" },
      { action: 'trimmed', field: "chapter 1's key image" },
    ])
  })

  it('notes nothing for a book within its limits', () => {
    const { notes, note } = collect()
    parseDirectorsBook(JSON.stringify(book()), 1, note)
    expect(notes).toEqual([])
  })

  it('reads as one line for the card, and leaves every fact as the model wrote it', () => {
    const answer = book()
    answer.eraLocks[0].rules = long
    answer.principals = [
      {
        name: 'Emad Mostaque',
        role: 'Founder',
        depiction: 'likeness',
        identityString: long,
        guardrail: 'Never mocked.',
      },
    ]
    answer.neverShow = Array.from({ length: 14 }, (_, at) => `exclusion ${at}`)
    const { notes, note } = collect()
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1, note)
    expect(describeRepairs(notes)).toBe(
      "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows.",
    )
    expect(parsed.principals[0]).toMatchObject({
      name: 'Emad Mostaque',
      role: 'Founder',
      depiction: 'likeness',
    })
    expect(parsed.eraLocks[0]!.span).toBe(answer.eraLocks[0].span)
    expect(parsed.palette).toMatchObject({
      accent: answer.palette.accent,
      temperature: answer.palette.temperature,
    })
  })
})

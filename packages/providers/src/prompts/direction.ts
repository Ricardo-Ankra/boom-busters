import { DirectorsBookSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook } from '@boom-busters/schemas'
import { z } from 'zod'
import { DIRECTION_CRAFT } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { claimList, type ScriptClaim } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The Director's Book prompt (decision 252): one call per film, after voice
 * approval and before the chapter shot lists. It reads the outline's tension
 * fields, every chapter's paragraphs and the claim list, and decides only
 * what legitimately varies between films; the House Visual Bible in the
 * system prompt holds everything that does not.
 *
 * Routed to the `direction` task (Sonnet by default): the book is the
 * highest-leverage prompt in the picture department, and it runs once.
 */

export interface DirectionChapterInput {
  title: string
  paragraphs: readonly string[]
  /** The open question this chapter plants, from the outline. */
  question?: string | undefined
  /** What this chapter deliberately withholds, from the outline. */
  withhold?: string | undefined
}

const BOOK_SHAPE = `Return JSON of this exact shape:
{
  "visualThesis": string (one or two sentences: what this film looks like and why),
  "eraLocks": [{"span": "1995 to 2008", "rules": "period-correct objects, named"}],
  "palette": {"accent": "#hex", "temperature": "cold"|"neutral"|"warm", "note": string},
  "motifs": [string, string, string] (exactly three recurring visual motifs),
  "anchorObject": string,
  "neverShow": [string] (this story's exclusions, beyond the bible's),
  "principals": [{"name", "role", "depiction": "likeness"|"anonymous"|"archival-only",
                  "identityString": string, "guardrail": string}],
  "locations": [{"name", "look"}],
  "chapters": [{"chapter": number (1-based, one entry per chapter, in order),
                "dominantShotFamily": "environment"|"document"|"human"|"data"|"map"|"object",
                "moodShift": string, "keyImage": string}],
  "finalImage": string
}`

export function buildDirectorsBookRequest(input: {
  caseTitle: string
  centralQuestion?: string | undefined
  chapters: readonly DirectionChapterInput[]
  claims: readonly ScriptClaim[]
  /** From `stillStyleAnchors`: the Brand Kit grade the palette must sit inside. */
  styleAnchors: string
}): LLMTaskRequest {
  const chapterText = input.chapters
    .map((chapter, index) => {
      const head = [`Chapter ${index + 1}: ${chapter.title}`]
      if (chapter.question) head.push(`Plants: ${chapter.question}`)
      if (chapter.withhold) head.push(`Withholds: ${chapter.withhold}`)
      return `${head.join('\n')}\n\n${chapter.paragraphs.join('\n\n')}`
    })
    .join('\n\n---\n\n')

  return {
    task: 'direction',
    system: `You are the director of a documentary about a corporate collapse, writing
the film's visual book before a single shot is planned. The narration is
recorded. Your book decides what varies for THIS film; the bible below decides
everything that does not.

${DIRECTION_CRAFT}

${BOOK_SHAPE}

Rules for the book:
- Principals are the real people the claims name. "identityString" describes
  the person as a photograph would (age range, build, hair, glasses, dress),
  never their character. "guardrail" names the only situations the claims
  support showing them in. Use "anonymous" when the person is not a public
  figure; "archival-only" when only real photographs should show them.
- Era locks name objects, not adjectives.
- The palette sits inside the Brand Kit grade: "${input.styleAnchors}".
- One chapter entry per chapter, numbered as given, in order.`,
    messages: [
      // The claim list is the cacheable prefix, like every script prompt.
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}\n` +
          (input.centralQuestion ? `Central question: ${input.centralQuestion}\n` : '') +
          `\nClaims:\n${claimList(input.claims)}`,
      },
      { role: 'user', content: chapterText },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(3000),
  }
}

const Envelope = z.looseObject({})

export function parseDirectorsBook(text: string, chapterCount: number): DirectorsBook {
  const raw = parseJsonCompletion(text, Envelope, "director's book")
  const parsed = DirectorsBookSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(`The director's book is malformed: ${formatIssues(parsed.error)}`, {
      field: "director's book",
    })
  }
  const numbers = parsed.data.chapters.map((chapter) => chapter.chapter)
  const expected = Array.from({ length: chapterCount }, (_, index) => index + 1)
  if (numbers.join(',') !== expected.join(',')) {
    throw new ValidationError(
      `The director's book covers chapters [${numbers.join(', ')}] but the script has ${chapterCount}.`,
      { field: "director's book" },
    )
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Deterministic book for `MOCK_PROVIDERS=1`. One anonymous principal, so the
 * guardrail and identity fields are exercised on the plan screen without a
 * real name ever appearing in a fixture.
 */
export function mockDirectorsBook(input: {
  caseTitle: string
  chapterCount: number
}): DirectorsBook {
  const families = ['environment', 'document', 'human', 'data', 'map', 'object'] as const
  return {
    visualThesis: `[mock] ${input.caseTitle}: a company that looked solid from the street and hollow from inside.`,
    eraLocks: [{ span: '2011 to 2020', rules: '[mock] flat screens, glass offices, smartphones' }],
    palette: {
      accent: '#c9a227',
      temperature: 'cold',
      note: '[mock] gold only on money and signatures',
    },
    motifs: [
      '[mock] reflections in dark glass',
      '[mock] empty chairs',
      '[mock] printed pages under lamplight',
    ],
    anchorObject: '[mock] a bound annual report',
    neverShow: ['[mock] cash in bags'],
    principals: [
      {
        name: '[mock] The chief executive',
        role: 'chief executive',
        depiction: 'anonymous',
        identityString: '[mock] man in his forties, dark suit, face turned from camera',
        guardrail: '[mock] shown at podiums and in corridors; never at a desk with documents',
      },
    ],
    locations: [
      { name: '[mock] Headquarters', look: '[mock] glass box on a business park, grey sky' },
    ],
    chapters: Array.from({ length: input.chapterCount }, (_, index) => ({
      chapter: index + 1,
      dominantShotFamily: families[index % families.length]!,
      moodShift: `[mock] chapter ${index + 1} tightens`,
      keyImage: `[mock] the key image of chapter ${index + 1}`,
    })),
    finalImage: '[mock] the headquarters at night, one floor lit',
  }
}

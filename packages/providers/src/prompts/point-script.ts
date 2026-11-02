import {
  PointScriptSchema,
  SHORT_PHASES,
  SHORT_RULES,
  ValidationError,
  pointScriptIssues,
} from '@boom-busters/schemas'
import type { BibleInUse, PointScript, TalkingPoint } from '@boom-busters/schemas'
import { z } from 'zod'
import { fillSlots } from './bible'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { scriptRules } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * One point Short's narration, written to the five-phase rule book (spec
 * 4.1). It pays off the point's small question and bridges to the long form.
 */

const TITLE_MAX = 90
const PARAGRAPH_MAX = 400
const PARAGRAPHS_MAX = 12

export function buildPointScriptRequest(input: {
  bible: BibleInUse
  caseTitle: string
  point: TalkingPoint
  chapters: readonly { index: number; title: string; contentMd: string }[]
  ctaLine: string | null
}): LLMTaskRequest {
  const { point } = input
  const bridgeTitles = point.bridgeChapters
    .map((index) => input.chapters.find((c) => c.index === index))
    .filter((c) => c !== undefined)
    .map((c) => `${c.index} (${c.title})`)
    .join(', ')

  return {
    task: 'scripting',
    system: fillSlots(
      `Write the narration for one 45 to 60 second vertical Short, ${SHORT_RULES.wordsMin} to ${SHORT_RULES.wordsMax} words in all,
about the talking point below. It pays off its own question and then points
at the deeper material only the full video has.

One paragraph per phase, in this order:
1. HOOK (0 to 3 s): the question or the most arresting fact, mid-action. No greeting, no channel name, no "in this video".
2. STAKES (3 to 15 s): why it matters: the cost, the paradox, who stood to lose.
3. DELIVERY (15 to 42 s): the substance, at speed, with "but" and "then" turns rather than "and".
4. RESOLUTION (42 to 52 s): the answer to the hook's question, in plain words. Pay it off; do not withhold it.
5. BRIDGE (52 to 60 s): what the full video has that this Short does not, then asking once to tap the linked video below.

Rules:
- Every fact comes from the chapters below. Invent nothing: no leaks, no documents, no sources the chapters do not name.
- The bridge promises only what the chapters listed as bridge chapters contain, and asks once.
- The words never ask for a subscribe, a like or a comment, and never ask for a click more than once.
- Spoken register: short sentences, concrete nouns, numbers said plainly.
- Each paragraph carries the chapterIndex whose part of the story it draws from, so the edit can show that chapter's visuals behind it. The bridge paragraph cites a bridge chapter.
${input.ctaLine ? `- The channel call to action, which the bridge's ask follows in wording: ${input.ctaLine}\n` : ''}
Limits (the app checks them): title 3 to ${TITLE_MAX} characters; each paragraph 10 to ${PARAGRAPH_MAX} characters; chapterIndex is the number of a chapter below, 0 to ${input.chapters.length - 1}.

Return exactly:
{"title": string, "paragraphs": [{"phase": "hook" | "stakes" | "delivery" | "resolution" | "bridge", "text": string, "chapterIndex": number}]}${scriptRules(input.bible)}`,
      input.bible,
    ),
    messages: [
      {
        role: 'user',
        content: [
          `Case: ${input.caseTitle}`,
          [
            `Type: ${point.type}`,
            `Working title: ${point.title}`,
            `Question: ${point.question}`,
            `Hook draft: ${point.hook}`,
            `Payoff: ${point.payoff}`,
            `Bridge: ${point.bridge}`,
            `Source chapters: ${point.sourceChapters.join(', ')}`,
            `Bridge chapters: ${bridgeTitles || point.bridgeChapters.join(', ')}`,
          ].join('\n'),
          input.chapters
            .map((c) => `## Chapter ${c.index} - ${c.title}\n\n${c.contentMd}`)
            .join('\n\n'),
        ].join('\n\n'),
      },
    ],
    maxTokens: outputBudget(2000),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The script as the model answered, repaired then validated (decision 293):
 * the title trimmed at a word, each paragraph at a sentence, no more than
 * twelve paragraphs kept. A missing phase, a wrong order or a chapter the
 * film does not have is refused: each changes what the Short says or shows.
 */
export function parsePointScript(
  text: string,
  chapterCount: number,
  note: Note = ignoreRepairs,
): PointScript {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'point script')
  const paragraphs = capList(raw['paragraphs'], PARAGRAPHS_MAX, 'paragraphs', note)
  const parsed = PointScriptSchema.safeParse({
    ...raw,
    title: trimField(raw['title'], TITLE_MAX, 'the title', note),
    paragraphs: Array.isArray(paragraphs)
      ? paragraphs.map((p, at) =>
          isRecord(p)
            ? {
                ...p,
                text: trimField(
                  p['text'],
                  PARAGRAPH_MAX,
                  typeof p['phase'] === 'string'
                    ? `the ${p['phase']} paragraph`
                    : `paragraph ${at + 1}`,
                  note,
                ),
              }
            : p,
        )
      : paragraphs,
  })
  if (!parsed.success) {
    throw new ValidationError(`The point script is malformed: ${formatIssues(parsed.error)}`, {
      field: 'point script',
    })
  }
  const issues = pointScriptIssues(parsed.data, chapterCount)
  if (issues.length > 0) {
    throw new ValidationError(`The point script is not usable: ${issues.join('; ')}`, {
      field: 'point script',
    })
  }
  return parsed.data
}

/** Deterministic, so mock runs and the E2E suite get a stable script: 26 words a phase, 130 in all. */
export function mockPointScript(point: TalkingPoint): PointScript {
  const filler =
    'a stand-in line that fills the time and must never be published or voiced for real'.split(' ')
  const paragraph = (lead: string): string => {
    const words = lead.split(' ')
    for (let i = 0; words.length < 26; i++) words.push(filler[i % filler.length]!)
    return words.join(' ')
  }
  const leads = [
    'MOCK SHORT hook:',
    'MOCK stakes:',
    'MOCK delivery:',
    'MOCK resolution:',
    'MOCK bridge: tap the linked video below.',
  ]
  return {
    title: `MOCK SHORT: ${point.title}`.slice(0, TITLE_MAX),
    paragraphs: SHORT_PHASES.map((phase, i) => ({
      phase,
      text: paragraph(leads[i]!),
      chapterIndex:
        phase === 'bridge' ? (point.bridgeChapters[0] ?? 0) : (point.sourceChapters[0] ?? 0),
    })),
  }
}

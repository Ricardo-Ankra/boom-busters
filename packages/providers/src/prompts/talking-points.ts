import {
  SHORT_RULES,
  TalkingPointDraftSchema,
  ValidationError,
  talkingPointSetIssues,
} from '@boom-busters/schemas'
import type { BibleInUse, TalkingPoint, TalkingPointDraft } from '@boom-busters/schemas'
import { z } from 'zod'
import { fillSlots } from './bible'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { scriptRules } from './script'
import type { ShortsTension } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The talking-point proposal (spec 3.2): three to five questions the approved
 * script already answers, each a seed for one playbook Short. The stage's
 * rules are stated here and enforced by `talkingPointSetIssues` where they
 * are mechanical.
 */

type Chapter = { index: number; title: string; contentMd: string }

export type TalkingPointsRedo =
  | { mode: 'all'; note: string | null; current: readonly TalkingPoint[] }
  | { mode: 'one'; pointId: string; note: string | null; current: readonly TalkingPoint[] }
  | { mode: 'add'; note: string | null; current: readonly TalkingPoint[] }

const FIELD_LIMITS = { title: 90, question: 300, payoff: 400, bridge: 400, hook: 300 } as const

const redoBlock = (redo: TalkingPointsRedo | undefined): string | null => {
  if (!redo) return null
  const current = redo.current
    .map((p) => JSON.stringify(p))
    .map((line) => `- ${line}`)
    .join('\n')
  const lines = [
    redo.mode === 'all'
      ? 'This is a redo. Propose the whole set again, keeping what already works.'
      : redo.mode === 'one'
        ? `This is a redo of one point. Replace only the point with id ${redo.pointId}. ` +
          'Return exactly one point, different from the others, and leave the others as they are.'
        : 'Add one new point to the current set. Return exactly one point, ' +
          'on a different question and, where the material allows, a different type.',
    redo.note ? `The owner's note: ${redo.note}` : null,
    `The current points:\n${current}`,
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}

export function buildTalkingPointsRequest(input: {
  bible: BibleInUse
  caseTitle: string
  chapters: readonly Chapter[]
  claims: readonly string[]
  tension?: ShortsTension
  redo?: TalkingPointsRedo
}): LLMTaskRequest {
  const tensionBlock = input.tension
    ? [
        input.tension.centralQuestion ? `Central question: ${input.tension.centralQuestion}` : null,
        ...input.tension.chapters.map((chapter) =>
          chapter.question ? `Chapter ${chapter.index} asks: ${chapter.question}` : null,
        ),
      ].filter((line): line is string => line !== null)
    : []
  const single = input.redo?.mode === 'one' || input.redo?.mode === 'add'
  const answerShape = single
    ? 'Return exactly one point:\n{"points": [point]}'
    : `Return ${SHORT_RULES.pointsMin} to ${SHORT_RULES.pointsMax} points:\n{"points": [point, ...]}`

  return {
    task: 'scripting',
    system: fillSlots(
      `Read the approved script below and propose talking points: questions the
script already answers, each one the seed of a single 45 to 60 second vertical
Short that funnels viewers into the full video.

Pick each point's type from these four:
- forensic-breakdown: take one document, number or event apart and show how it works.
- contrarian-thesis: open on what most people believe, then show the script's evidence against it.
- incomplete-mechanism: show how part of a scheme worked and leave the deeper mechanism to the long form.
- result-first: open on the outcome, then trace how it came about.

Each point is:
{"type": one of the four above, "title": string, "question": string,
 "payoff": string, "bridge": string, "bridgeChapters": [number],
 "sourceChapters": [number], "hook": string, "order": number}
- question: the one question the Short opens with and answers.
- payoff: the answer the Short gives, in a sentence. Every fact in it must come from the script below, so the payoff must be something the script states.
- bridge: the deeper thing the long form has that the Short does not, in a sentence. It names only what the chapters in bridgeChapters contain.
- sourceChapters: the chapters the Short's facts come from; bridgeChapters: the chapters that hold the bridge's material. Both are chapter numbers from below, 0 to ${input.chapters.length - 1}.
- hook: a draft of the Short's first line.
- order: the suggested publishing order, 1 first. The strongest standalone hook goes first.

Rules:
- Every fact comes from the script and claims below. Invent nothing: no leaks, no documents, no sources the script does not name.
- Points do not overlap: no two share a question, and no chapter is the main source of more than two points.
- Use at least two different types across the set.
- Limits (the app checks them): title ${FIELD_LIMITS.title} characters, question ${FIELD_LIMITS.question}, payoff ${FIELD_LIMITS.payoff}, bridge ${FIELD_LIMITS.bridge}, hook ${FIELD_LIMITS.hook}.
- Spoken register: concrete nouns, numbers said plainly. No greetings, no channel talk.

${answerShape}${scriptRules(input.bible)}`,
      input.bible,
    ),
    messages: [
      {
        role: 'user',
        content: [
          `Case: ${input.caseTitle}`,
          tensionBlock.length > 0 ? tensionBlock.join('\n') : null,
          input.claims.length > 0
            ? `Claims the script rests on:\n${input.claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            : null,
          input.chapters
            .map((c) => `## Chapter ${c.index} - ${c.title}\n\n${c.contentMd}`)
            .join('\n\n'),
          redoBlock(input.redo),
        ]
          .filter((part): part is string => part !== null)
          .join('\n\n'),
      },
    ],
    maxTokens: outputBudget(single ? 1500 : 3500),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The points as the model answered, repaired before validation (decision
 * 293): free-text fields trimmed at a sentence, more than five points capped
 * at five. Types, order and chapter indexes carry facts and are never touched.
 */
export function parseTalkingPoints(
  text: string,
  chapterCount: number,
  expect: 'set' | 'single',
  note: Note = ignoreRepairs,
): TalkingPointDraft[] {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'talking points')
  const listed = capList(
    raw['points'],
    expect === 'single' ? 1 : SHORT_RULES.pointsMax,
    'talking points',
    note,
  )
  const repaired = Array.isArray(listed)
    ? listed.map((item, at) =>
        isRecord(item)
          ? {
              ...item,
              ...Object.fromEntries(
                (Object.keys(FIELD_LIMITS) as (keyof typeof FIELD_LIMITS)[]).map((key) => [
                  key,
                  trimField(item[key], FIELD_LIMITS[key], `point ${at + 1} ${key}`, note),
                ]),
              ),
            }
          : item,
      )
    : listed
  const parsed = z.array(TalkingPointDraftSchema).min(1).safeParse(repaired)
  if (!parsed.success) {
    throw new ValidationError(`The talking points are malformed: ${formatIssues(parsed.error)}`, {
      field: 'talking points',
    })
  }
  const issues =
    expect === 'set'
      ? talkingPointSetIssues(parsed.data, chapterCount)
      : parsed.data[0]!.sourceChapters.concat(parsed.data[0]!.bridgeChapters).some(
            (c) => c >= chapterCount,
          )
        ? [`a chapter index points past the last chapter (${chapterCount} chapters)`]
        : []
  if (issues.length > 0) {
    throw new ValidationError(`The talking points are not usable: ${issues.join('; ')}`, {
      field: 'talking points',
    })
  }
  return parsed.data
}

/** Deterministic, so mock runs and the E2E suite get a stable proposal. */
export function mockTalkingPoints(chapters: readonly Chapter[]): TalkingPointDraft[] {
  const at = (i: number): number => chapters[i % Math.max(chapters.length, 1)]?.index ?? 0
  const bridge = chapters[chapters.length - 1]?.index ?? 0
  const types = ['forensic-breakdown', 'contrarian-thesis', 'result-first'] as const
  return types.map((type, i) => ({
    type,
    title: `MOCK POINT ${i + 1}`,
    question: `MOCK QUESTION ${i + 1}: what does this stand-in point ask?`,
    payoff: `MOCK PAYOFF ${i + 1}: the stand-in answer the script would state.`,
    bridge: `MOCK BRIDGE ${i + 1}: the deeper material only the long form has.`,
    bridgeChapters: [bridge],
    sourceChapters: [at(i)],
    hook: `MOCK HOOK ${i + 1}: a stand-in first line.`,
    order: i + 1,
  }))
}

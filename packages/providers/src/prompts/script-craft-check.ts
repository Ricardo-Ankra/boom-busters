import { CRAFT_FINDINGS_MAX, CraftCheckSchema, ValidationError } from '@boom-busters/schemas'
import type { BibleInUse, CraftCheck, ScriptCraftFinding, Outline } from '@boom-busters/schemas'
import { z } from 'zod'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
import { fillSlots } from './bible'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import {
  buildChapterRequest,
  craftFor,
  houseStyle,
  ownershipBrief,
  scriptRules,
  tensionContract,
} from './script'
import type { ChapterRequestInput, ScriptIntent } from './script'

/**
 * The script editor's answer: at most eight findings of a few sentences each.
 * The same sizing as the critic's report (decision 450), a little larger.
 */
export const CRAFT_OUTPUT_TOKENS = 2000

/**
 * The editor's room to think (decision 450's precedent: the critic, on the
 * standard headroom, spent it all thinking and wrote no report). It reads one
 * chapter against the whole rule set and the script so far. A ceiling, not a
 * spend: the ledger settles on the tokens produced.
 */
export const CRAFT_THINKING_TOKENS = 10_000

/** The checklist for a documentary chapter, one line per fault. */
const TENSION_CHECKLIST = [
  'opening by restating or paraphrasing where the script so far ended',
  "ending on resolution, a moral, a summary or a formulaic tease, where a chapter should end on a turn (the final chapter's close, as its contract describes, is the one exception)",
  'a recap in the middle',
  'a rhetorical question',
  "the chapter's planted question answered in the same chapter",
  'a withheld fact leaked',
  'a stand-alone caveat sentence',
  'metronomic sentences',
  'tags that gasp at everything',
  'a figure, name or attribution the listener has already heard, repeated in full',
]

/** The same list for a calm telling: no planted question or withheld fact, and its own ending. */
const CALM_CHECKLIST = [
  'opening by restating or paraphrasing where the script so far ended',
  'ending on a cliffhanger, a tease or a moral, where a calm chapter settles on its last fact',
  'a recap in the middle',
  'a rhetorical question',
  'a stand-alone caveat sentence',
  'metronomic sentences',
  'tags that gasp at everything',
  'a figure, name or attribution the listener has already heard, repeated in full',
]

export function buildCraftCheckRequest(input: {
  bible: BibleInUse
  outline: Outline
  chapterIndex: number
  claimCount: number
  previousChapters: readonly { title: string; contentMd: string }[]
  contentMd: string
  intent?: ScriptIntent
}): LLMTaskRequest {
  const chapter = input.outline.chapters[input.chapterIndex]!
  const checklist = (input.intent === 'calm' ? CALM_CHECKLIST : TENSION_CHECKLIST)
    .map((line) => `- ${line}`)
    .join('\n')
  const ownership = ownershipBrief(input.outline, input.chapterIndex, input.claimCount)
  const contract = tensionContract(input.outline, input.chapterIndex, input.intent)
  const brief = [ownership, contract].filter((part) => part !== '').join('\n\n')
  // The chapters are joined as the writer's own "script so far" joins them,
  // without its instruction to the writer.
  const soFar =
    input.previousChapters.length === 0
      ? 'This is the opening chapter.'
      : `The script so far, which the listener has just heard:\n\n${input.previousChapters
          .map((c, i) => `## ${i + 1}. ${c.title}\n\n${c.contentMd}`)
          .join('\n\n')}`

  return {
    task: 'scripting',
    system: fillSlots(
      `You are the script editor, not the writer. You read ONE chapter against the rules it was drafted under and report where it breaks them. You never rewrite it, and you never judge its facts: another reviewer checks those.

The rules the writer drafted under:

${houseStyle(input.bible.bible)}

${craftFor(input.intent)}${scriptRules(input.bible)}

Look for:
${checklist}

Report at most eight findings, and only what you would make the writer fix. A chapter with nothing worth fixing gets an empty list. A fix never adds a fact, a figure, a name or a quote: it cuts, moves or rewords.

The text may contain bracketed narration tags — [pause], [long pause], [sighs] and the like: direction for the narrator, not words. Ignore them entirely; never flag one and never quote one in a sentence.

Quote the sentence EXACTLY as it appears, including its punctuation: it is matched back to the text character for character.

{"findings": [{"sentence": string, "problem": string, "fix": string}]}`,
      input.bible,
    ),
    messages: [
      { role: 'user', content: soFar },
      ...(brief ? [{ role: 'user' as const, content: brief }] : []),
      { role: 'user', content: `Chapter "${chapter.title}" to review:\n\n${input.contentMd}` },
    ],
    maxTokens: outputBudget(CRAFT_OUTPUT_TOKENS, CRAFT_THINKING_TOKENS),
  }
}

const LooseAnswer = z.looseObject({})
const FIELD_MAX = 300

/**
 * The editor's answer, repaired before it is validated (decision 293): more
 * than eight findings keep the first eight, and a long problem or fix is
 * trimmed at a sentence. A sentence is never cut: it is matched back to the
 * chapter character for character.
 */
function repairCraftCheck(answer: Record<string, unknown>, note: Note): unknown {
  const findings = capList(answer['findings'], CRAFT_FINDINGS_MAX, 'craft findings', note)
  if (!Array.isArray(findings)) return answer
  return {
    ...answer,
    findings: findings.map((finding, at) =>
      typeof finding === 'object' && finding !== null && !Array.isArray(finding)
        ? {
            ...finding,
            problem: trimField(
              (finding as Record<string, unknown>)['problem'],
              FIELD_MAX,
              `finding ${at + 1}'s problem`,
              note,
            ),
            fix: trimField(
              (finding as Record<string, unknown>)['fix'],
              FIELD_MAX,
              `finding ${at + 1}'s fix`,
              note,
            ),
          }
        : finding,
    ),
  }
}

export function parseCraftCheck(text: string, note: Note = ignoreRepairs): CraftCheck {
  const answer = parseJsonCompletion(text, LooseAnswer, 'craft check')
  const parsed = CraftCheckSchema.safeParse(repairCraftCheck(answer, note))
  if (!parsed.success) {
    throw new ValidationError(
      `The model's craft check did not match the expected shape: ${formatIssues(parsed.error)}`,
      { field: 'craft check' },
    )
  }
  return parsed.data
}

/** Mock mode finds nothing, so a mock run never revises. */
export function mockCraftCheck(_contentMd: string): CraftCheck {
  return { findings: [] }
}

/**
 * The chapter request with one more message: the draft and the editor's notes.
 * The system, the cacheable prefix and the budget are the writer's own.
 */
export function buildChapterRevisionRequest(
  input: ChapterRequestInput & { draft: string; findings: readonly ScriptCraftFinding[] },
): LLMTaskRequest {
  const { draft, findings, ...chapterInput } = input
  const base = buildChapterRequest(chapterInput)
  const notes = findings
    .map((f, i) => `${i + 1}. "${f.sentence}": ${f.problem} Instead: ${f.fix}`)
    .join('\n')
  return {
    ...base,
    messages: [
      ...base.messages,
      {
        role: 'user',
        content: `Revise this draft. Fix these and change nothing else.\n\nThe draft:\n\n${draft}\n\nThe script editor's notes:\n${notes}`,
      },
    ],
  }
}

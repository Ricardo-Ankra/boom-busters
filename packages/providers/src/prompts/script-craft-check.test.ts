import {
  CRAFT_FINDINGS_MAX,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_IN_USE,
  OutlineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { ScriptCraftFinding } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { outputBudget } from '../llm/types'
import { FINANCE_WORDS, PSYCHOLOGY_TEST_BIBLE } from './lift/psychology-bible'
import type { Repair } from './repair'
import { buildChapterRequest } from './script'
import { SCRIPT_CRAFT, SCRIPT_CRAFT_CALM } from './script-craft'
import {
  CRAFT_OUTPUT_TOKENS,
  CRAFT_THINKING_TOKENS,
  buildChapterRevisionRequest,
  buildCraftCheckRequest,
  mockCraftCheck,
  parseCraftCheck,
} from './script-craft-check'

const outline = OutlineSchema.parse({
  centralQuestion: 'How did 1.9 billion euros never exist?',
  storylines: ['the money', 'the auditors'],
  close: {
    answer: 'The money never existed; the signatures did.',
    echo: 'The auditors signed.',
    openThread: 'The trial of the chief operating officer has no date.',
  },
  chapters: [
    {
      title: 'The setup',
      beat: 'x'.repeat(30),
      storyline: 'the money',
      claims: [1],
      question: 'Why did the auditors keep signing?',
      withhold: 'The accounts in Manila were empty all along.',
      stakes: 'Thirty thousand pensions',
      constraints: 'Never state that the CEO knew; the claim is single-source.',
      targetWords: 800,
    },
    {
      title: 'The turn',
      beat: 'y'.repeat(30),
      claims: [2],
      reveals: 'The accounts in Manila were empty all along.',
      targetWords: 900,
    },
  ],
})

const firstLine = (text: string) => text.split('\n').find((l) => l.trim().length > 20)!

const checkInput = {
  bible: FIRST_CHANNEL_IN_USE,
  outline,
  chapterIndex: 1,
  claimCount: 2,
  previousChapters: [{ title: 'The setup', contentMd: 'Money vanished. Nobody asked.' }],
  contentMd: 'The accounts were empty. And that was the lesson.',
}

describe('buildCraftCheckRequest', () => {
  it('judges by the craft file the drafter saw', () => {
    const tension = buildCraftCheckRequest(checkInput)
    expect(tension.system).toContain(firstLine(SCRIPT_CRAFT))
    expect(tension.system).toContain('You are the script editor, not the writer')
    expect(tension.system).toContain('planted question')
    const calm = buildCraftCheckRequest({ ...checkInput, intent: 'calm' })
    expect(calm.system).toContain(firstLine(SCRIPT_CRAFT_CALM))
    // The calm craft file itself says there is no planted question, so the checklist lines are the tell.
    expect(calm.system).not.toContain('planted question answered')
    expect(calm.system).not.toContain('a withheld fact leaked')
    expect(tension.system).toContain('planted question answered')
    expect(tension.system).toContain('a withheld fact leaked')
  })

  it('runs on the scripting route with thinking room', () => {
    const request = buildCraftCheckRequest(checkInput)
    expect(request.task).toBe('scripting')
    expect(request.maxTokens).toBe(outputBudget(CRAFT_OUTPUT_TOKENS, CRAFT_THINKING_TOKENS))
  })

  it('sends the script so far, the contract and the chapter, last', () => {
    const request = buildCraftCheckRequest(checkInput)
    const last = request.messages.at(-1)!
    expect(last.content.startsWith('Chapter "')).toBe(true)
    expect(last.content.endsWith(checkInput.contentMd)).toBe(true)
    expect(request.messages[0]!.content).toContain('## 1. The setup\n\nMoney vanished.')
    const opening = buildCraftCheckRequest({ ...checkInput, chapterIndex: 0, previousChapters: [] })
    expect(opening.messages[0]!.content).toBe('This is the opening chapter.')
  })

  it("names the close as the final chapter's one exception", () => {
    expect(buildCraftCheckRequest(checkInput).system).toContain("the final chapter's close")
  })
})

describe('parseCraftCheck', () => {
  const finding = (n: number) => ({
    sentence: `Sentence ${n}.`,
    problem: n === 0 ? 'It recaps what was said. '.repeat(20) : 'It recaps what was said.',
    fix: 'Cut it.',
  })

  it('reads findings back, capping at eight and trimming long fields', () => {
    const repairs: Repair[] = []
    const answer = JSON.stringify({ findings: Array.from({ length: 10 }, (_, n) => finding(n)) })
    const result = parseCraftCheck(answer, (r) => repairs.push(r))
    expect(result.findings).toHaveLength(CRAFT_FINDINGS_MAX)
    expect(result.findings[0]!.problem.length).toBeLessThanOrEqual(300)
    expect(repairs).toContainEqual({ action: 'capped', field: 'craft findings', kept: 8 })
  })

  it('refuses an answer with no findings list', () => {
    expect(() => parseCraftCheck('{}')).toThrow(ValidationError)
  })

  it('the mock finds nothing', () => {
    expect(mockCraftCheck('Any chapter.')).toEqual({ findings: [] })
  })
})

describe('buildChapterRevisionRequest', () => {
  const chapterInput = {
    bible: FIRST_CHANNEL_IN_USE,
    caseTitle: 'Wirecard',
    outline,
    chapterIndex: 1,
    previousChapters: [{ title: 'The setup', contentMd: 'Money vanished.' }],
    claims: [],
  }
  const f: ScriptCraftFinding = {
    sentence: 'And that was the lesson.',
    problem: 'It ends on a moral.',
    fix: 'Stop on the empty accounts.',
  }

  it('revises with the chapter request plus the draft and the notes', () => {
    const base = buildChapterRequest(chapterInput)
    const revised = buildChapterRevisionRequest({ ...chapterInput, draft: 'D.', findings: [f] })
    expect({ ...revised, messages: revised.messages.slice(0, -1) }).toEqual(base)
    expect(revised.messages).toHaveLength(base.messages.length + 1)
    const last = revised.messages.at(-1)!
    expect(last.role).toBe('user')
    expect(last.content.startsWith('Revise this draft. Fix these and change nothing else.')).toBe(
      true,
    )
    expect(last.content).toContain(`1. "${f.sentence}": ${f.problem} Instead: ${f.fix}`)
    expect(last.content).toContain('The draft:\n\nD.')
  })
})

describe('under the psychology bible', () => {
  it('carries no finance word', () => {
    const inUse = { bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS }
    const systems = [
      buildCraftCheckRequest({ ...checkInput, bible: inUse }).system,
      buildCraftCheckRequest({ ...checkInput, bible: inUse, intent: 'calm' }).system,
      buildChapterRevisionRequest({
        bible: inUse,
        caseTitle: 'A study',
        outline,
        chapterIndex: 0,
        previousChapters: [],
        claims: [],
        draft: 'D.',
        findings: [],
      }).system,
    ]
    for (const system of systems) {
      const lower = system.toLowerCase()
      expect(FINANCE_WORDS.filter((w) => lower.includes(w))).toEqual([])
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  buildChapterRequest,
  MAX_OUTPUT_TOKENS,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
} from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { draftChapterWith, draftOutlineWith, markShortsWith, selfCheckWith } from './script-answers'

const outlineInput = {
  caseTitle: 'Case',
  dossierMd: 'The dossier.',
  claims: [],
  targetRuntimeMin: 10,
}
const chapter = { chapterTitle: 'The audit', contentMd: 'The money was gone.', claims: [] }
const chapters = [{ index: 0, title: 'The audit', contentMd: 'The money was gone. Nobody asked.' }]

describe('the script answers (decision 292)', () => {
  it('drafts the outline in one call when the answer is good', async () => {
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
    expect((await draftOutlineWith(complete, outlineInput)).chapters.length).toBeGreaterThan(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('asks for the outline once more with the reason, then stops the stage with it', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'not json at all' })
    const drafting = draftOutlineWith(complete, outlineInput)
    await expect(drafting).rejects.toBeInstanceOf(NonRetriableError)
    await expect(draftOutlineWith(complete, outlineInput)).rejects.toThrow(
      /^The outline could not be drafted: /,
    )
    expect(complete).toHaveBeenCalledTimes(4)
    expect(complete.mock.calls[1]![1]).toBe('retry: refused')
  })

  it('reads a self-check, and names the chapter when it stops', async () => {
    const good = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify(mockSelfCheck(chapter.contentMd)) })
    expect((await selfCheckWith(good, chapter)).warnings.length).toBeGreaterThan(0)

    const bad = vi.fn().mockResolvedValue({ text: 'not json at all' })
    await expect(selfCheckWith(bad, chapter)).rejects.toThrow(
      /^The self-check of "The audit" could not be read: /,
    )
    expect(bad).toHaveBeenCalledTimes(2)
  })

  it('marks the Shorts segments, and stops with the reason after two refusals', async () => {
    const good = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ candidates: mockShortsCandidates(chapters) }) })
    expect(await markShortsWith(good, { chapters })).toEqual({
      candidates: mockShortsCandidates(chapters),
      repairs: [],
    })

    const bad = vi.fn().mockResolvedValue({ text: 'not json at all' })
    await expect(markShortsWith(bad, { chapters })).rejects.toThrow(
      /^The Shorts segments could not be marked: /,
    )
    expect(bad).toHaveBeenCalledTimes(2)
  })

  it('returns what the repair changed beside the candidates (decision 293)', async () => {
    const [first] = mockShortsCandidates(chapters)
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [{ ...first, hookRationale: long }] }),
    })

    const marked = await markShortsWith(complete, { chapters })

    expect(marked.candidates).toHaveLength(1)
    expect(marked.candidates[0]!.startSentence).toBe(first!.startSentence)
    expect(marked.repairs).toEqual([{ action: 'trimmed', field: "candidate 1's hook" }])
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('the chapter draft (decision 293)', () => {
  const chapterInput = {
    caseTitle: 'Case',
    outline: mockOutline(10),
    chapterIndex: 1,
    previousTail: 'The money was gone.',
    claims: [],
  }
  const request = buildChapterRequest(chapterInput)

  it('drafts a chapter in one call when the reply is whole', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'A whole chapter.' })
    expect(await draftChapterWith(complete, chapterInput)).toBe('A whole chapter.')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(request, 'answer')
  })

  it('asks once more at double the budget when the chapter is cut off, and keeps none of the half', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'By June the auditors could', truncated: true })
      .mockResolvedValueOnce({ text: 'By June the auditors could not find the money.' })
    expect(await draftChapterWith(complete, chapterInput)).toBe(
      'By June the auditors could not find the money.',
    )
    expect(complete.mock.calls[1]![0]).toEqual({
      ...request,
      maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2),
    })
    expect(complete.mock.calls[1]![1]).toBe('retry: cut off')
  })

  it('stops the stage after a second cut-off, naming the chapter by its number', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'By June the auditors', truncated: true })
    const drafting = draftChapterWith(complete, chapterInput)
    await expect(drafting).rejects.toBeInstanceOf(NonRetriableError)
    await expect(drafting).rejects.toThrow(
      'Chapter 2 could not be drafted: the answer was cut off at its length limit',
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a budget stop through, for the runner to park on its gate', async () => {
    const over = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.scripting',
      budgetUsd: 30,
      monthSpendUsd: 29.9,
      estimateUsd: 0.4,
    })
    await expect(draftChapterWith(vi.fn().mockRejectedValue(over), chapterInput)).rejects.toBe(over)
  })
})

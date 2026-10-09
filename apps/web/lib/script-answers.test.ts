import { describe, expect, it, vi } from 'vitest'
import { mockOutline, mockSelfCheck, mockShortsCandidates } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { draftOutlineWith, markShortsWith, selfCheckWith } from './script-answers'

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

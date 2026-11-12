import { describe, expect, it } from 'vitest'
import type { ScriptCraftFinding } from '@boom-busters/schemas'
import { craftWarning, NOTICE_MESSAGE_MAX } from '@boom-busters/schemas'
import { settleCraft } from './script-craft-loop'

const finding = (n: number, problem = `Problem ${n}.`): ScriptCraftFinding => ({
  sentence: `Sentence ${n}.`,
  problem,
  fix: `Fix ${n}.`,
})
const [a, b, c] = [finding(1), finding(2), finding(3)] as [
  ScriptCraftFinding,
  ScriptCraftFinding,
  ScriptCraftFinding,
]
const draftMd = 'Sentence 1. Sentence 2. Sentence 3. The rest.'
const revisedMd = 'Sentence 3. The rest, tighter.'
const base = { chapterNumber: 2, draftMd, first: { findings: [a, b, c] }, recheck: null }

describe('settling the craft loop (decision 463)', () => {
  it('keeps the first draft and says so when the first check stopped', () => {
    expect(
      settleCraft({
        ...base,
        first: { findings: [], stopped: 'the answer was empty' },
        revisedMd: null,
      }),
    ).toEqual({
      warnings: [],
      notices: [
        {
          kind: 'stopped',
          message:
            'Chapter 2: the craft check stopped: the answer was empty. The chapter keeps its first draft.',
        },
      ],
    })
  })

  it('says nothing when the first check found nothing', () => {
    expect(settleCraft({ ...base, first: { findings: [] }, revisedMd: null })).toEqual({
      warnings: [],
      notices: [],
    })
  })

  it('puts every first finding in the gutter when the revision stopped', () => {
    expect(settleCraft({ ...base, revisedMd: null, reviseStopped: 'cut off' })).toEqual({
      warnings: [a, b, c].map(craftWarning),
      notices: [
        {
          kind: 'stopped',
          message:
            'Chapter 2: the craft revision stopped: cut off. Its craft notes are in the gutter.',
        },
      ],
    })
  })

  it('shows the recheck findings and names what was fixed when the recheck landed', () => {
    const left = finding(3)
    const result = settleCraft({ ...base, revisedMd, recheck: { findings: [left] } })
    expect(result.warnings).toEqual([craftWarning(left)])
    expect(result.notices).toEqual([
      { kind: 'trimmed', message: 'Chapter 2 revised for craft: Problem 1; Problem 2.' },
    ])
  })

  it('keeps the unfixed first findings and adds a stop when the recheck stopped', () => {
    const result = settleCraft({
      ...base,
      revisedMd,
      recheck: { findings: [], stopped: 'bad json' },
    })
    expect(result.warnings).toEqual([craftWarning(c)])
    expect(result.notices).toEqual([
      { kind: 'trimmed', message: 'Chapter 2 revised for craft: Problem 1; Problem 2.' },
      { kind: 'stopped', message: 'Chapter 2: the craft recheck stopped: bad json.' },
    ])
  })

  it('never counts a paraphrased finding as fixed', () => {
    const result = settleCraft({
      ...base,
      first: { findings: [finding(9)] },
      revisedMd,
      recheck: { findings: [] },
    })
    expect(result.notices).toEqual([{ kind: 'trimmed', message: 'Chapter 2 revised for craft.' }])
    expect(result.warnings).toEqual([])
  })

  it('lists each fixed finding once in one notice', () => {
    const left = finding(3)
    const result = settleCraft({
      ...base,
      first: { findings: [a, b, c, finding(1)] },
      revisedMd,
      recheck: { findings: [left] },
    })
    expect(result.notices).toHaveLength(1)
    expect(result.notices[0]!.message).toBe('Chapter 2 revised for craft: Problem 1; Problem 2.')
    expect(result.warnings).toEqual([craftWarning(left)])
  })

  it('cuts the revised line to the notice limit', () => {
    const many = Array.from({ length: 8 }, (_, n) => finding(n + 1, 'z'.repeat(300)))
    const result = settleCraft({
      ...base,
      draftMd: many.map((f) => f.sentence).join(' '),
      first: { findings: many },
      revisedMd: 'Nothing left.',
      recheck: { findings: [] },
    })
    expect(result.notices[0]!.message.length).toBeLessThanOrEqual(NOTICE_MESSAGE_MAX)
  })
})

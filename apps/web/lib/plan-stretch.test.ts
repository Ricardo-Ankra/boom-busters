import { describe, expect, it, vi } from 'vitest'
import type { LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { cutStretch, type StretchRow } from '@/inngest/lib/stretch'
import type { TimedParagraph } from '@/inngest/lib/shot-list'
import { timingFindings } from '@/inngest/lib/timing-findings'
import { planStretchWith, type PlanStretchInput } from './plan-stretch'

function words(text: string, startMs: number, stepMs = 500) {
  return text.split(' ').map((word, i) => ({ text: word, startMs: startMs + i * stepMs }))
}

const P0 = 'In 2021 CNBC reported that the company had lied to investors about its blood tests'
const P1 = 'Then the board stepped in and the founder was forced to resign within a week'

const paragraphs: TimedParagraph[] = [
  { chapterId: 'c1', index: 0, text: P0, startMs: 0, durationMs: 8500, words: words(P0, 0) },
  {
    chapterId: 'c1',
    index: 1,
    text: P1,
    startMs: 8500,
    durationMs: 8000,
    words: words(P1, 8500),
  },
]

const news: ScriptClaim = {
  id: 'claim-cnbc',
  text: 'CNBC reported that Theranos misled investors.',
  sourceUrl: 'https://www.cnbc.com/2021/09/08/theranos-trial-investors.html',
  confidence: 'high',
  sourceType: 'major_outlet',
}

const still = (coversText: string) => ({
  type: 'still',
  coversText,
  description: 'The board at the table.',
  shotSize: 'wide',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Four directors at a long table, dusk light from the windows. 24mm, eye level.',
})

const headline = (coversText: string) => ({
  type: 'headline',
  coversText,
  description: 'The CNBC report on the morning it ran.',
  shotSize: 'graphic',
  motion: { kind: 'static' },
  transition: 'cut',
  sourceRef: 1,
})

const answer = (...slots: { paragraphIndex?: number; seconds: number; brief: unknown }[]) =>
  JSON.stringify({ slots: slots.map((slot) => ({ paragraphIndex: 0, ...slot })) })

const row = (id: string, index: number, startMs: number, durationMs: number, coversText: string) =>
  ({
    id,
    chapterId: 'c1',
    index,
    type: 'still',
    brief: still(coversText),
    startMs,
    durationMs,
    coversText,
  }) satisfies StretchRow

const A = row('a', 0, 0, 4000, 'In 2021 CNBC reported that the company')
const B = row('b', 1, 4000, 4500, 'had lied to investors about its blood tests')
const C = row('c', 2, 8500, 8000, 'Then the board stepped in and the founder')

const cut = cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, B.id], paragraphs })
if (!cut.ok) throw new Error('fixture')

const input: PlanStretchInput = {
  caseTitle: 'Theranos',
  chapter: { id: 'c1', title: 'The fall', number: 1 },
  paragraphs,
  claims: [news],
  direction: null,
  stretch: cut.stretch,
  before: null,
  after: C.brief,
  headlineAllowed: true,
  startIndex: 0,
}

/** A completion that answers from a script and records each call's purpose. */
function scripted(...texts: string[]) {
  const calls: string[] = []
  const requests: LLMTaskRequest[] = []
  const complete = vi.fn(async (request: LLMTaskRequest, purpose: string) => {
    calls.push(purpose)
    requests.push(request)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)]! }
  })
  return { complete, calls, requests }
}

describe('planStretchWith', () => {
  it('returns new rows for an answer that covers the stretch', async () => {
    const { complete, calls } = scripted(
      answer(
        { seconds: 4, brief: still('In 2021 CNBC reported that the company') },
        { seconds: 4.5, brief: still('had lied to investors about its blood tests') },
      ),
    )
    const outcome = await planStretchWith(complete, input)
    if (!outcome.ok) throw new Error(outcome.issue)
    expect(calls).toEqual(['stretch'])
    expect(outcome.slots).toHaveLength(2)
    expect(outcome.rows.map((r) => [r.startMs, r.durationMs])).toEqual([
      [0, 3500],
      [3500, 5000],
    ])
    for (const r of outcome.rows) {
      expect(r.chapterId).toBe('c1')
      expect(r.startMs).toBeGreaterThanOrEqual(cut.stretch.startMs)
      expect(r.startMs + r.durationMs).toBeLessThanOrEqual(cut.stretch.endMs)
    }
  })

  it('numbers the new rows from startIndex', async () => {
    const { complete } = scripted(
      answer(
        { seconds: 4, brief: still('In 2021 CNBC reported that the company') },
        { seconds: 4.5, brief: still('had lied to investors about its blood tests') },
      ),
    )
    const outcome = await planStretchWith(complete, { ...input, startIndex: 7 })
    expect(outcome.ok && outcome.rows.map((r) => r.index)).toEqual([7, 8])
  })

  it('asks once more when a slot is dropped in conversion, then stops with the reason', async () => {
    const { complete: alwaysTwoHeadlines, calls } = scripted(
      answer(
        { seconds: 4, brief: headline('In 2021 CNBC reported that the company') },
        { seconds: 4.5, brief: headline('had lied to investors about its blood tests') },
      ),
    )
    const outcome = await planStretchWith(alwaysTwoHeadlines, { ...input, headlineAllowed: false })
    expect(outcome).toEqual({ ok: false, issue: expect.stringContaining('headline') })
    expect(calls).toEqual(['stretch', 'retry: refused'])
  })

  it('counts a malformed slot as a dropped one', async () => {
    const { complete, calls } = scripted(
      answer(
        { seconds: 4, brief: still('In 2021 CNBC reported that the company') },
        { seconds: 4.5, brief: { type: 'still' } },
      ),
    )
    const outcome = await planStretchWith(complete, input)
    expect(outcome).toEqual({ ok: false, issue: expect.stringContaining('1 of your 2 shots') })
    expect(calls).toEqual(['stretch', 'retry: refused'])
  })

  it('accepts a too-short shot on the second answer and leaves it flagged', async () => {
    const short = answer(
      { seconds: 2, brief: still('In 2021 CNBC reported') },
      {
        seconds: 6.5,
        brief: still('that the company had lied to investors about its blood tests'),
      },
    )
    const { complete, calls, requests } = scripted(short, short)
    const outcome = await planStretchWith(complete, input)
    if (!outcome.ok) throw new Error(outcome.issue)
    expect(calls).toEqual(['stretch', 'retry: refused'])
    expect(requests[1]!.messages.at(-1)!.content).toMatch(
      /^Your previous answer was refused: this AI image is on screen for 2\.0 s/,
    )
    const flagged = timingFindings(
      outcome.rows.map((r) => ({
        chapterId: r.chapterId,
        type: r.type,
        startMs: r.startMs!,
        durationMs: r.durationMs!,
        coversText: (r.brief as { coversText?: string }).coversText ?? null,
      })),
      paragraphs,
    )
    expect(flagged.map((finding) => finding.kind)).toEqual(['too-short'])
  })

  it('sends the owner note and the before and after briefs', async () => {
    const { complete, requests } = scripted(
      answer(
        { seconds: 4, brief: still('In 2021 CNBC reported that the company') },
        { seconds: 4.5, brief: still('had lied to investors about its blood tests') },
      ),
    )
    await planStretchWith(complete, {
      ...input,
      before: { type: 'stock', coversText: 'Earlier words' },
      note: 'keep the headline card up through the CNBC line',
      reason: 'this shot and the next both quote "had lied to investors…"',
    })
    const asked = requests[0]!
    expect(asked.task).toBe('shotlist')
    const last = asked.messages.at(-1)!.content
    expect(last).toContain("Producer's note: keep the headline card up through the CNBC line")
    expect(last).toContain('Before: {"type":"stock","coversText":"Earlier words"}')
    expect(last).toContain(`After: ${JSON.stringify(C.brief)}`)
    expect(last).toContain('Why: this shot and the next both quote')
    expect(last).toContain('must start with "In 2021 CNBC reported that the"')
  })

  it('runs the brief repair on the accepted slots, and keeps them when it fails', async () => {
    // A third wide shot in a row is an `auto` craft finding.
    const whole = cutStretch({
      chapterRows: [A, B, C],
      selectedIds: [A.id, B.id, C.id],
      paragraphs,
    })
    if (!whole.ok) throw new Error('fixture')
    const threeWide = answer(
      { seconds: 4, brief: still('In 2021 CNBC reported that the company') },
      { seconds: 4.5, brief: still('had lied to investors about its blood tests') },
      { paragraphIndex: 1, seconds: 8, brief: still(P1) },
    )
    const calls: string[] = []
    const complete = vi.fn(async (_request: LLMTaskRequest, purpose: string) => {
      calls.push(purpose)
      if (purpose === 'repair') throw new Error('down')
      return { text: threeWide }
    })
    const outcome = await planStretchWith(complete, {
      ...input,
      stretch: whole.stretch,
      after: null,
    })
    expect(calls).toEqual(['stretch', 'repair'])
    expect(outcome.ok && outcome.rows).toHaveLength(3)
  })

  it('says so for a chapter with no narration, without a call', async () => {
    const { complete } = scripted('{}')
    expect(await planStretchWith(complete, { ...input, paragraphs: [] })).toEqual({
      ok: false,
      issue: 'this chapter has no narration to plan',
    })
    expect(complete).not.toHaveBeenCalled()
  })

  it('lets a budget stop through', async () => {
    const over = new BudgetExceededError({
      provider: 'google',
      operation: 'llm.shotlist',
      budgetUsd: 30,
      monthSpendUsd: 30,
      estimateUsd: 0.01,
    })
    await expect(planStretchWith(vi.fn().mockRejectedValue(over), input)).rejects.toBe(over)
  })
})

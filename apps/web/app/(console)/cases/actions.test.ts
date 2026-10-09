// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestCases } from './actions'

/**
 * `Suggest cases` on the answer helper (decision 293), with the database,
 * the session and the model call replaced: at most two calls, each created
 * case's repairs filed on its own row, and what no row can show (a dropped
 * suggestion, the cut to the number asked for) in the toast line.
 */

const store = vi.hoisted(() => ({
  existingCaseTitles: vi.fn(),
  createSuggestedCases: vi.fn(),
}))
vi.mock('@boom-busters/db', () => store)
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs }))

const wirecard = {
  title: 'Wirecard',
  category: 'con',
  angle: 'The auditor sign-offs are the story, not the missing billion.',
  demandNotes: 'Sustained search interest since the 2020 collapse.',
  competitorLinks: [{ url: 'https://example.com/video', note: 'surface level' }],
  priorityScore: 88,
}

const reply = (...suggestions: Record<string, unknown>[]) => ({
  text: JSON.stringify({ suggestions }),
})

/** What `createSuggestedCases` hands back: one row per title, ids in order. */
const rows = (...titles: string[]) => ({
  created: titles.map((title, at) => ({ id: `01J00000000000000000000C0${at + 1}`, title })),
  skippedTitles: [],
})

describe('suggestCases on the answer helper (decision 293)', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    recordRepairs.mockReset()
    store.existingCaseTitles.mockReset().mockResolvedValue([])
    store.createSuggestedCases.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason after a refusal, labelled in the ledger', async () => {
    callLlm.mockResolvedValueOnce({ text: 'no json here' }).mockResolvedValueOnce(reply(wirecard))
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard'))

    expect(await suggestCases({ count: 3 })).toEqual({
      ok: true,
      created: 1,
      skipped: 0,
      mocked: false,
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[0]![1]).toEqual({})
    expect(callLlm.mock.calls[1]![1]).toEqual({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: The model returned no JSON for case suggestions/,
    )
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('creates nothing after two refusals, and says why', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    const result = await suggestCases({ count: 3 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^The model returned no JSON for case suggestions/)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(store.createSuggestedCases).not.toHaveBeenCalled()
  })

  it("files each created case's repairs on its own row", async () => {
    callLlm.mockResolvedValueOnce(
      reply(
        { ...wirecard, angle: 'The auditors signed off for a decade. '.repeat(60) },
        { ...wirecard, title: 'Theranos', priorityScore: 104.6 },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos', 'Enron'))

    expect(await suggestCases({ count: 3 })).toEqual({
      ok: true,
      created: 3,
      skipped: 0,
      mocked: false,
    })
    const inputs = store.createSuggestedCases.mock.calls[0]![1] as { priorityScore: number }[]
    expect(inputs.map((input) => input.priorityScore)).toEqual([88, 100, 88])
    expect(recordRepairs.mock.calls).toEqual([
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C01' },
        [{ action: 'trimmed', field: 'the angle of Wirecard' }],
      ],
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C02' },
        [{ action: 'rounded', field: 'the priority score of Theranos', from: 104.6, to: 100 }],
      ],
    ])
  })

  it('names a dropped suggestion and the cut to the number asked for in the toast line', async () => {
    const title = `The ${'very '.repeat(50)}long case`
    callLlm.mockResolvedValueOnce(
      reply(
        wirecard,
        { ...wirecard, title },
        { ...wirecard, title: 'Theranos' },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos'))

    const result = await suggestCases({ count: 2 })
    expect(result).toMatchObject({ ok: true, created: 2 })
    expect(result.notice).toBe(
      `Dropped suggestion 2 ("The${' very'.repeat(11)}..."): its title ran over 200 characters. ` +
        'Kept the first 2 suggestions.',
    )
    const inputs = store.createSuggestedCases.mock.calls[0]![1] as { title: string }[]
    expect(inputs.map((input) => input.title)).toEqual(['Wirecard', 'Theranos'])
    expect(recordRepairs).not.toHaveBeenCalled()
  })
})

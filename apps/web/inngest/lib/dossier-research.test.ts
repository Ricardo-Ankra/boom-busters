// @vitest-environment node

import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { researchDossier } from './dossier-research'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

/**
 * The four research passes on the answer helper (decision 293), with a step
 * that runs each body as Inngest does the first time a run reaches it, or
 * hands back a stored result as it does when a parked run replays. No
 * database: the passes write nothing; the save steps do, and the runner's
 * and reviser's tests cover them.
 */

type Step = Parameters<typeof researchDossier>[0]

const live = {
  run: async (_id: string, body: () => Promise<unknown>) => body(),
} as unknown as Step

const replaying = (stored: Record<string, unknown>) =>
  ({ run: async (id: string) => stored[id] }) as unknown as Step

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const input = { projectId: '01J0000000000000000000000P', caseContext: CASE, round: 0 }

const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  principals: [{ name: 'Markus Braun', role: 'Chief executive' }],
  openQuestions: ['Where did the 1.9 billion euros go?'],
}
const EVENT = { when: 'June 2020', what: 'Wirecard filed for insolvency in Munich.' }
const CLAIM = {
  text: 'Wirecard filed for insolvency in June 2020.',
  sourceUrl: 'https://www.ft.com/wirecard',
  sourceType: 'major_outlet',
  confidence: 'sourced',
  adjudicated: false,
}
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}

const reply = (value: unknown) => ({ text: JSON.stringify(value) })
const thin = { ...BRIEF, summary: 'It collapsed.' }

describe('researchDossier on the answer helper (decision 293)', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks a refused pass once more with its reason, then carries on', async () => {
    callLlm
      .mockResolvedValueOnce(reply(thin))
      .mockResolvedValueOnce(reply(BRIEF))
      .mockResolvedValueOnce(reply({ events: [EVENT] }))
      .mockResolvedValueOnce(reply({ claims: [CLAIM] }))
      .mockResolvedValueOnce(reply(ANSWERS))

    const research = await researchDossier(live, input)

    expect(research.brief.summary).toBe(BRIEF.summary)
    expect(callLlm).toHaveBeenCalledTimes(5)
    expect(callLlm.mock.calls[0]![1]).not.toHaveProperty('purpose')
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: The model's case brief did not match the expected shape/,
    )
  })

  it('stops the stage with the reason after a second refusal, with no blind retry', async () => {
    callLlm.mockResolvedValue(reply(thin))

    const stopped = researchDossier(live, input)

    await expect(stopped).rejects.toBeInstanceOf(NonRetriableError)
    await expect(stopped).rejects.toThrow(
      /^The research brief could not be written: The model's case brief did not match the expected shape/,
    )
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it("carries each pass's repairs, named so the owner can tell the passes apart", async () => {
    callLlm
      .mockResolvedValueOnce(reply({ ...BRIEF, summary: 'Wirecard grew fast. '.repeat(300) }))
      .mockResolvedValueOnce(
        reply({ events: [EVENT, { when: 'x'.repeat(101), what: 'A date that ran away.' }] }),
      )
      .mockResolvedValueOnce(reply({ claims: [CLAIM, { ...CLAIM, text: 'A'.repeat(1001) }] }))
      .mockResolvedValueOnce(
        reply({
          answers: [
            {
              index: 1,
              question: 'Where did the 1.9 billion euros go?',
              answer: 'Nobody has found it. '.repeat(200),
            },
          ],
          claims: [],
        }),
      )

    const research = await researchDossier(live, input)

    expect(research.repairs).toEqual([
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'dropped', field: 'timeline event 2', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'claim 2', reason: 'its text ran over 1,000 characters' },
      { action: 'trimmed', field: 'the answer to question 1' },
    ])
    expect(research.timeline).toHaveLength(1)
    expect(research.claims.map((claim) => claim.text)).toEqual([CLAIM.text])
    expect(callLlm).toHaveBeenCalledTimes(4)
  })

  it('reads a replayed step result without repairs as none, and calls nothing', async () => {
    // A run parked before decision 293 replays results stored without `repairs`.
    const research = await researchDossier(
      replaying({
        'research-brief-0': { ok: true, value: BRIEF },
        'research-timeline-0': { ok: true, value: [EVENT] },
        'research-claims-0': { ok: true, value: [CLAIM] },
        'research-answers-0': { ok: true, value: ANSWERS },
      }),
      input,
    )

    expect(research.repairs).toEqual([])
    expect(research.brief).toEqual(BRIEF)
    expect(research.claims).toEqual([CLAIM])
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('still parks on the budget gate rather than failing the stage', async () => {
    callLlm.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'research',
        budgetUsd: 50,
        monthSpendUsd: 49.9,
        estimateUsd: 0.5,
      }),
    )

    const research = await researchDossier(live, input)

    expect(research.budgetGate).toMatchObject({ gate: 'budget', provider: 'anthropic' })
    expect(research.repairs).toEqual([])
    expect(callLlm).toHaveBeenCalledTimes(1)
  })
})

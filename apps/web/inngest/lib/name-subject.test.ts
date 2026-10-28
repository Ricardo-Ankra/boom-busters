// @vitest-environment node

import {
  createCase,
  deleteCase,
  getCase,
  requireTestDatabase,
  ensureFirstChannel,
} from '@boom-busters/db'
import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import type { AnswerComplete } from '@/lib/answer'
import { nameSubjectIfMissing } from './name-subject'

const describeDb = requireTestDatabase() ? describe : describe.skip

const reply = (subject: string, people: string[] = []): AnswerComplete =>
  vi.fn(async () => ({ text: JSON.stringify({ subject, people }) }))

describeDb('nameSubjectIfMissing', () => {
  const made: string[] = []

  async function bare() {
    const row = await createCase(db, {
      channelId: (await ensureFirstChannel(db)).id,
      title: `Namesubjecttest ${Date.now()} ${Math.random().toString(36).slice(2)}`,
      category: 'collapse',
    })
    made.push(row.id)
    return row
  }

  afterEach(async () => {
    for (const id of made.splice(0)) await deleteCase(db, id)
  })

  it('names a subject once, stores it, and reuses it on replay', async () => {
    const row = await bare()
    const complete = reply('Wirecard', ['Markus Braun'])

    const first = await nameSubjectIfMissing(db, row, { complete, mocked: false })
    expect(first).toEqual({ subject: 'Wirecard', people: ['Markus Braun'] })
    expect(complete).toHaveBeenCalledTimes(1)
    expect((await getCase(db, row.id))?.subject).toBe('Wirecard')

    const again = await nameSubjectIfMissing(db, (await getCase(db, row.id))!, {
      complete,
      mocked: false,
    })
    expect(again).toEqual(first)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('makes no call for a case that has a subject', async () => {
    const complete = reply('Other')
    const named = await nameSubjectIfMissing(
      db,
      { ...(await bare()), subject: 'Enron', people: ['Jeffrey Skilling'] },
      { complete, mocked: false },
    )
    expect(named).toEqual({ subject: 'Enron', people: ['Jeffrey Skilling'] })
    expect(complete).not.toHaveBeenCalled()
  })

  it('cuts a subject that comes back as a sentence to 120 characters', async () => {
    const row = await bare()
    const sentence = 'Wirecard was a German payments company that collapsed in 2020. '.repeat(5)
    const named = await nameSubjectIfMissing(db, row, {
      complete: reply(sentence),
      mocked: false,
    })
    expect(named.subject.length).toBeLessThanOrEqual(120)
    expect((await getCase(db, row.id))?.subject).toBe(named.subject)
  })

  it('names from the title in mock mode without calling the model', async () => {
    const row = await bare()
    const complete = reply('never')
    const named = await nameSubjectIfMissing(db, row, { complete, mocked: true })
    expect(named.subject).toBe(row.title)
    expect(complete).not.toHaveBeenCalled()
  })

  it('stops with a plain message, not a blind retry, when the budget is spent', async () => {
    const row = await bare()
    const complete: AnswerComplete = async () => {
      throw new BudgetExceededError({
        provider: 'anthropic',
        operation: 'complete',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.01,
      })
    }
    await expect(nameSubjectIfMissing(db, row, { complete, mocked: false })).rejects.toBeInstanceOf(
      NonRetriableError,
    )
    expect((await getCase(db, row.id))?.subject).toBeNull()
  })

  it('stops the stage when the answer is still unusable after the retry', async () => {
    const row = await bare()
    const complete: AnswerComplete = vi.fn(async () => ({ text: '{"people": []}' }))
    await expect(nameSubjectIfMissing(db, row, { complete, mocked: false })).rejects.toThrow(
      /could not be named/,
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })
})

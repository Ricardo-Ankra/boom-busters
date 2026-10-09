import { describe, expect, it, vi } from 'vitest'
import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest, Note } from '@boom-busters/providers'
import {
  AnswerDeclined,
  BudgetExceededError,
  ContentPolicyError,
  ValidationError,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import {
  ANSWER_CUT_OFF,
  AnswerStopped,
  EMPTY_ANSWER,
  answerOrStop,
  callForAnswer,
  callForText,
} from './answer'

const request: LLMTaskRequest = {
  task: 'direction',
  system: 'system',
  messages: [{ role: 'user', content: 'the question' }],
  maxTokens: 1000,
}

/** "good" parses; "cut" is a reply cut off mid-JSON; anything else is refused with its text. */
function parse(text: string): string {
  if (text === 'cut') throw new ValidationError('cut off mid-answer', { field: 'maxTokens' })
  if (text !== 'good') throw new ValidationError(`bad answer: ${text}`, { field: 'answer' })
  return 'parsed'
}

const answers = (...texts: string[]) => {
  const complete = vi.fn()
  for (const text of texts) complete.mockResolvedValueOnce({ text })
  return complete
}

describe('callForAnswer (decision 292)', () => {
  it('takes a good first answer in one call', async () => {
    const complete = answers('good')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 1,
    })
    expect(complete).toHaveBeenCalledWith(request, 'answer')
  })

  it('asks once more at double the budget when the answer is cut off mid-JSON', async () => {
    const complete = answers('cut', 'good')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 2,
    })
    const [retry, label] = complete.mock.calls[1]!
    expect(label).toBe('retry: cut off')
    expect(retry).toEqual({ ...request, maxTokens: 2000 })
  })

  it('treats a reply the adapter throws as cut off the same way', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('empty reply', { field: 'maxTokens' }))
      .mockResolvedValueOnce({ text: 'good' })
    expect(await callForAnswer({ request, parse, complete })).toMatchObject({ ok: true, calls: 2 })
  })

  it('caps the doubled budget, and makes no second call when already at the cap', async () => {
    const near = answers('cut', 'good')
    await callForAnswer({ request: { ...request, maxTokens: 20_000 }, parse, complete: near })
    expect(near.mock.calls[1]![0].maxTokens).toBe(MAX_OUTPUT_TOKENS)

    const atCap = answers('cut')
    expect(
      await callForAnswer({
        request: { ...request, maxTokens: MAX_OUTPUT_TOKENS },
        parse,
        complete: atCap,
      }),
    ).toEqual({ ok: false, issue: ANSWER_CUT_OFF, calls: 1 })
    expect(atCap).toHaveBeenCalledTimes(1)
  })

  it('counts a refused reply the provider flagged as truncated as a cut-off', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: '', truncated: true })
      .mockResolvedValueOnce({ text: 'good' })
    expect(await callForAnswer({ request, parse, complete })).toMatchObject({ ok: true, calls: 2 })
    const [retry, label] = complete.mock.calls[1]!
    expect(label).toBe('retry: cut off')
    expect(retry).toEqual({ ...request, maxTokens: 2000 })
  })

  it('stops a truncated reply that does not parse, at the cap, after one call', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'no json', truncated: true })
    expect(
      await callForAnswer({
        request: { ...request, maxTokens: MAX_OUTPUT_TOKENS },
        parse,
        complete,
      }),
    ).toEqual({ ok: false, issue: ANSWER_CUT_OFF, calls: 1 })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('accepts a truncated reply that parses', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'good', truncated: true })
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 1,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('asks once more with the reason after a refusal, at the same budget', async () => {
    const complete = answers('nope', 'good')
    expect(await callForAnswer({ request, parse, complete })).toMatchObject({ ok: true, calls: 2 })
    const [retry, label] = complete.mock.calls[1]!
    expect(label).toBe('retry: refused')
    expect(retry.maxTokens).toBe(1000)
    expect(retry.messages.at(-1)).toEqual({
      role: 'user',
      content:
        'Your previous answer was refused: bad answer: nope. Answer again in full with that fixed.',
    })
  })

  it("uses the task's own retry request when it has one", async () => {
    const complete = answers('nope', 'good')
    const own = { ...request, messages: [{ role: 'user' as const, content: 'rebuilt' }] }
    const retryWithReason = vi.fn(() => own)
    await callForAnswer({ request, parse, complete, retryWithReason })
    expect(retryWithReason).toHaveBeenCalledWith('bad answer: nope')
    expect(complete.mock.calls[1]![0]).toBe(own)
  })

  it('stops after two refusals with the second reason, and never makes a third call', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'nope' })
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: 'bad answer: nope',
      calls: 2,
    })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('stops with the cut-off issue when the retry after a refusal is cut off', async () => {
    const complete = answers('nope', 'cut')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 2,
    })
    const own = answers('nope', 'cut')
    expect(
      await callForAnswer({ request, parse, complete: own, cutOffIssue: 'too long for us' }),
    ).toMatchObject({ ok: false, issue: 'too long for us' })
  })

  it('stops with the reason when the doubled answer is refused', async () => {
    expect(await callForAnswer({ request, parse, complete: answers('cut', 'nope') })).toEqual({
      ok: false,
      issue: 'bad answer: nope',
      calls: 2,
    })
  })

  it('lets a budget stop and a provider error through unchanged', async () => {
    const budget = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.direction',
      budgetUsd: 5,
      monthSpendUsd: 5,
      estimateUsd: 0.5,
    })
    await expect(
      callForAnswer({ request, parse, complete: vi.fn().mockRejectedValue(budget) }),
    ).rejects.toBe(budget)
    const down = new Error('503 from the provider')
    await expect(
      callForAnswer({ request, parse, complete: vi.fn().mockRejectedValue(down) }),
    ).rejects.toBe(down)
  })

  it('stops a call-side validation error without a retry, as a NonRetriableError (spec 2.1)', async () => {
    // Thrown by the CALL, not the parse, and not a cut-off: never a reason-retry,
    // and wrapped so Inngest does not re-run the step either.
    const key = new ValidationError('the key was rejected', { field: 'apiKey' })
    const complete = vi.fn().mockRejectedValue(key)
    const stopped = await callForAnswer({ request, parse, complete }).catch((e: unknown) => e)
    expect(stopped).toBeInstanceOf(NonRetriableError)
    expect((stopped as NonRetriableError).message).toBe('the key was rejected')
    expect((stopped as NonRetriableError).cause).toBe(key)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('answerOrStop (decision 292)', () => {
  it('returns the value of an answer', () => {
    expect(answerOrStop({ ok: true, value: 7, calls: 1 }, 'The outline')).toBe(7)
  })

  it('throws a stop Inngest will not retry, naming what stopped and why', () => {
    const stop = () =>
      answerOrStop({ ok: false, issue: 'bad answer', calls: 2 }, 'The outline could not be drafted')
    expect(stop).toThrow(NonRetriableError)
    expect(stop).toThrow('The outline could not be drafted: bad answer')
  })

  it('keeps the bare reason for a caller that words the stop its own way (decision 293)', () => {
    let stopped: unknown
    try {
      answerOrStop(
        { ok: false, issue: ANSWER_CUT_OFF, calls: 2 },
        "The director's book could not be drafted",
      )
    } catch (error) {
      stopped = error
    }
    expect(stopped).toBeInstanceOf(AnswerStopped)
    expect(stopped).toBeInstanceOf(NonRetriableError)
    expect((stopped as AnswerStopped).issue).toBe(ANSWER_CUT_OFF)
    expect((stopped as AnswerStopped).message).toBe(
      "The director's book could not be drafted: the answer was cut off at its length limit",
    )
    // Inngest also recognises a stop by this name.
    expect((stopped as AnswerStopped).name).toBe('NonRetriableError')
  })
})

describe('repairs and final answers (decision 293)', () => {
  it('returns the repairs noted on the attempt that succeeded, not the refused one', async () => {
    const complete = answers('bad', 'good')
    const parse = (text: string, note: Note) => {
      note({ action: 'trimmed', field: `the ${text} summary` })
      if (text !== 'good') throw new ValidationError('bad answer', { field: 'answer' })
      return 'parsed'
    }
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 2,
      repairs: [{ action: 'trimmed', field: 'the good summary' }],
    })
  })

  it('leaves repairs off an answer nothing was repaired in', async () => {
    const answer = await callForAnswer({ request, parse, complete: answers('good') })
    expect('repairs' in answer).toBe(false)
  })

  it('takes a deliberate decline as final, after one call', async () => {
    const complete = answers('declined')
    const declining = () => {
      throw new AnswerDeclined('there are no numbers to chart', { field: 'brief' })
    }
    expect(await callForAnswer({ request, parse: declining, complete })).toEqual({
      ok: false,
      issue: 'there are no numbers to chart',
      calls: 1,
      declined: true,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('takes a decline on the retry as final too', async () => {
    const complete = answers('bad', 'declined')
    const declining = (text: string) => {
      if (text === 'declined')
        throw new AnswerDeclined('no person can be shown', { field: 'brief' })
      throw new ValidationError('bad answer', { field: 'answer' })
    }
    expect(await callForAnswer({ request, parse: declining, complete })).toEqual({
      ok: false,
      issue: 'no person can be shown',
      calls: 2,
      declined: true,
    })
  })

  it("takes a provider's content refusal as final, after one call", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ContentPolicyError('anthropic', 'the request was declined'))
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: 'anthropic: the request was declined',
      calls: 1,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('callForText (decision 293)', () => {
  const replies = (...replies: { text: string; truncated?: boolean }[]) => {
    const complete = vi.fn()
    for (const reply of replies) complete.mockResolvedValueOnce(reply)
    return complete
  }

  it('takes a whole reply in one call', async () => {
    const complete = replies({ text: 'A whole digest.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole digest.',
      calls: 1,
    })
  })

  it('asks once more at double the budget when the reply is truncated, keeping nothing half-written', async () => {
    const complete = replies({ text: 'Half a', truncated: true }, { text: 'A whole digest.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole digest.',
      calls: 2,
    })
    expect(complete).toHaveBeenLastCalledWith({ ...request, maxTokens: 2000 }, 'retry: cut off')
  })

  it('stops after a second truncated reply', async () => {
    const complete = replies(
      { text: 'Half', truncated: true },
      { text: 'Half again', truncated: true },
    )
    expect(await callForText({ request, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 2,
    })
  })

  it('stops after one call when a truncated reply was already at the cap', async () => {
    const complete = replies({ text: 'Half', truncated: true })
    const atCap = { ...request, maxTokens: MAX_OUTPUT_TOKENS }
    expect(await callForText({ request: atCap, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 1,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("counts the adapter's empty-reply error as a cut-off", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('no text at max_tokens', { field: 'maxTokens' }))
      .mockResolvedValueOnce({ text: 'A whole chapter.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole chapter.',
      calls: 2,
    })
    expect(complete).toHaveBeenLastCalledWith({ ...request, maxTokens: 2000 }, 'retry: cut off')
  })

  it('refuses an empty reply once, with the reason', async () => {
    const complete = replies({ text: '   ' }, { text: 'A whole passage.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole passage.',
      calls: 2,
    })
    const [retry, call] = complete.mock.calls[1]!
    expect(call).toBe('retry: refused')
    expect(retry.messages.at(-1)?.content).toContain(EMPTY_ANSWER)
  })
})

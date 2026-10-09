// @vitest-environment node

import {
  addNotice,
  chapters,
  FIXTURE_PROJECT_ID,
  listProjectNotices,
  notices,
  requireTestDatabase,
  scripts,
  seed,
} from '@boom-busters/db'
import { BudgetExceededError, noticesFor } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { writeTeaserScript } from './teaser-build'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

/**
 * The teaser script on the answer helper (decision 293), against the test
 * database with the model call replaced: at most two calls, its notices on
 * the Teaser card's place, a stop skipped with the reason, a provider error
 * thrown for Inngest to retry, and the budget keeping its gate.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

const FIRST = { text: 'One number was missing, and it was billions.', chapterIndex: 0 }
const SECOND = { text: 'Then the shares collapsed in nine days.', chapterIndex: 1 }

const reply = (paragraphs: { text: string; chapterIndex: number }[]) => ({
  text: JSON.stringify({ title: 'The audit that said no', paragraphs }),
})

const teaserNotices = async () =>
  noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'teaser')

describeDb('writeTeaserScript (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await db.delete(notices)
    await db.delete(scripts)
    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1, shortsCandidates: [] })
      .returning({ id: scripts.id })
    await db.insert(chapters).values([
      {
        scriptId: script!.id,
        index: 0,
        title: 'The audit',
        contentMd: 'By June, the auditors could not find the money.',
      },
      {
        scriptId: script!.id,
        index: 1,
        title: 'The collapse',
        contentMd: 'The shares collapsed in nine days.',
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lands a clean teaser in one call and retires the old note on the Teaser card', async () => {
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'teaser', subjectId: null },
      { kind: 'skipped', message: 'The teaser was skipped: an older reason' },
    )
    callLlm.mockResolvedValueOnce(reply([FIRST, SECOND]))

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toEqual({
      ok: true,
      title: 'The audit that said no',
      paragraphs: [FIRST, SECOND],
      scriptVersion: 1,
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: FIXTURE_PROJECT_ID })
    expect(await teaserNotices()).toEqual([])
  })

  it('asks once more after a refusal, and says on the Teaser card what it trimmed', async () => {
    const long = {
      text: 'One number was missing, and it was billions. '.repeat(10),
      chapterIndex: 0,
    }
    callLlm
      .mockResolvedValueOnce({ text: 'no json here' })
      .mockResolvedValueOnce(reply([long, SECOND]))

    const written = await writeTeaserScript(FIXTURE_PROJECT_ID)
    expect(written).toMatchObject({ ok: true, title: 'The audit that said no' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toEqual({
      projectId: FIXTURE_PROJECT_ID,
      purpose: 'retry: refused',
    })
    expect((await teaserNotices()).map((notice) => notice.message)).toEqual([
      'Trimmed to fit: beat 1.',
    ])
  })

  it('refuses a beat from a chapter the film does not have, and tells the retry the range', async () => {
    callLlm
      .mockResolvedValueOnce(reply([FIRST, { ...SECOND, chapterIndex: 7 }]))
      .mockResolvedValueOnce(reply([FIRST, SECOND]))

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toMatchObject({ ok: true })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'beat 2 draws from chapter 7, but the chapters run 0 to 1',
    )
  })

  it('skips the teaser with the reason on its card after two refusals', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      skipped: expect.stringMatching(/^the teaser script failed: The model returned no JSON/),
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    const [notice] = await teaserNotices()
    expect(notice).toMatchObject({
      kind: 'skipped',
      message: expect.stringMatching(/^The teaser was skipped: The model returned no JSON/),
    })
  })

  it('throws a provider error for Inngest to retry, writing no notice', async () => {
    callLlm.mockRejectedValue(new Error('socket hang up'))

    const thrown = await writeTeaserScript(FIXTURE_PROJECT_ID).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(NonRetriableError)
    expect((thrown as Error).message).toBe('socket hang up')
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(await teaserNotices()).toEqual([])
  })

  it('keeps the budget gate', async () => {
    callLlm.mockRejectedValue(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.scripting',
        budgetUsd: 10,
        monthSpendUsd: 9.99,
        estimateUsd: 0.05,
      }),
    )

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toMatchObject({
      ok: false,
      gate: { gate: 'budget', provider: 'anthropic' },
    })
    expect(await teaserNotices()).toEqual([])
  })
})

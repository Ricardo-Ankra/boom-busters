// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  saveChapter,
  seed,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANSWER_CUT_OFF } from '@/lib/answer'
import { db } from '@/lib/db'
import { regenerateSection } from './actions'

/**
 * The Regenerate button's rewrite (decision 293) against the test database:
 * plain text on `callForText`, so a passage cut off at its budget is asked
 * once more at double it, and half a passage never reaches the diff view.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const SELECTION = 'By June, the auditors could not find the money anywhere at all.'

describeDb('regenerateSection (decision 293)', () => {
  let chapterId = ''

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: `${SELECTION} EY refused to sign the accounts.`,
      estRuntimeSec: 20,
    })
    chapterId = chapter.id
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the passage is cut off, and proposes none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: 'By June, the auditors', truncated: true })
      .mockResolvedValueOnce({ text: '  By June, nobody could say where the money had gone.  ' })

    expect(
      await regenerateSection(FIXTURE_PROJECT_ID, chapterId, SELECTION, 'Make it plainer'),
    ).toEqual({ ok: true, proposal: 'By June, nobody could say where the money had gone.' })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({ projectId: FIXTURE_PROJECT_ID })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'retry: cut off' })
  })

  it('returns the reason for the toast after a second cut-off', async () => {
    callLlm.mockResolvedValue({ text: 'By June, the auditors', truncated: true })

    expect(
      await regenerateSection(FIXTURE_PROJECT_ID, chapterId, SELECTION, 'Make it plainer'),
    ).toEqual({ ok: false, error: ANSWER_CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })
})

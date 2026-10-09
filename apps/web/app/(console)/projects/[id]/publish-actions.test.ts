// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  publishRecords,
  requireTestDatabase,
  seed,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { generateTitles } from './publish-actions'

/**
 * The Generate titles button (decision 293) against the test database: at
 * most two calls, so a cut-off answer is asked once more at double the
 * budget, and half a list of titles is never offered.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const HALF = '{"titles": ["The audit that said no to the mon'
const WHOLE = JSON.stringify({
  titles: ['The audit that said no to the money', 'Nine days from a record high to nothing'],
})

describeDb('generateTitles (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    // A record another suite scheduled would refuse the edit.
    await db.delete(publishRecords)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the titles are cut off, and offers none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: HALF, truncated: true })
      .mockResolvedValueOnce({ text: WHOLE })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, estimateOutputTokens: 500 })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'retry: cut off' })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      titleOptions: [
        'The audit that said no to the money',
        'Nine days from a record high to nothing',
      ],
    })
  })

  it('stops after a second cut-off with the reason, and offers nothing', async () => {
    callLlm.mockResolvedValue({ text: HALF, truncated: true })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      error: 'The titles could not be generated: the answer was cut off at its length limit',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).not.toHaveProperty(
      'titleOptions',
    )
  })
})

// @vitest-environment node

import { mockVidiqClient } from '@boom-busters/providers/vidiq'
import type { VidiqClient } from '@boom-busters/providers/vidiq'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  awaitNicheTest,
  CAP_REACHED,
  CapReached,
  readComments,
  searchField,
  startNicheTest,
} from './case-evidence'

/**
 * The evidence helpers against the mock VidIQ client. The spend path is
 * stubbed to hand the mock client straight to the call (its own tests cover
 * the cap and the ledger), so no database is needed.
 */

const spend = vi.hoisted(() => ({ cap: false, client: null as VidiqClient | null }))

vi.mock('@/lib/vidiq-spend', () => {
  class VidiqCapReached extends Error {}
  return {
    VidiqCapReached,
    spendVidiq: (_input: unknown, call: (c: VidiqClient) => Promise<unknown>) => {
      if (spend.cap) return Promise.reject(new VidiqCapReached('The VidIQ cap is reached'))
      return call(spend.client as VidiqClient)
    },
    withVidiqClient: (fn: (c: VidiqClient) => Promise<unknown>) => fn(spend.client as VidiqClient),
  }
})

const CHANNEL = 'channel-1'

beforeEach(() => {
  spend.cap = false
  spend.client = mockVidiqClient()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('searchField', () => {
  it('maps the probe search to a field check', async () => {
    const check = await searchField('wework documentary', CHANNEL)
    expect(check.keyword).toBe('wework documentary')
    expect(Number.isNaN(Date.parse(check.checkedAt))).toBe(false)
    expect(check.results.length).toBeGreaterThan(0)
    expect(check.results.length).toBeLessThanOrEqual(10)
    expect(check.results[0]).toEqual({
      videoId: expect.any(String),
      title: expect.any(String),
      channelTitle: expect.any(String),
      subscribers: expect.anything(),
      views: expect.anything(),
      publishedAt: expect.any(String),
      seconds: expect.anything(),
    })
  })

  it('turns a cap refusal into CapReached', async () => {
    spend.cap = true
    await expect(searchField('x', CHANNEL)).rejects.toBeInstanceOf(CapReached)
    expect(CAP_REACHED).toBe('credit cap')
  })
})

describe('readComments', () => {
  it('drops the creator comments', async () => {
    const client = mockVidiqClient()
    spend.client = {
      ...client,
      videoComments: () =>
        Promise.resolve({
          data: [
            { text: 'Great', likes: 3, byOwner: false, isReply: false },
            { text: 'Thanks all', likes: 9, byOwner: true, isReply: true },
          ],
          credits: 5,
          args: {},
        }),
    }
    const comments = await readComments('vid1', CHANNEL)
    expect(comments).toEqual([
      { text: 'Great', likes: 3, byOwner: false, isReply: false, videoId: 'vid1' },
    ])
  })
})

describe('startNicheTest', () => {
  it('returns the job id', async () => {
    expect(await startNicheTest({ niche: 'business', idea: 'leases' }, CHANNEL)).toBe(
      'job_fixture_0001',
    )
  })
})

describe('awaitNicheTest', () => {
  const poll = (...states: unknown[]) => {
    const jobPoll = vi.fn()
    for (const s of states) jobPoll.mockResolvedValueOnce({ data: s, credits: 0, args: {} })
    spend.client = { ...mockVidiqClient(), jobPoll }
    return jobPoll
  }

  it('maps a completed job', async () => {
    const jobPoll = poll({ status: 'inprogress' }, { status: 'completed', result: completed })
    vi.useFakeTimers()
    const pending = awaitNicheTest('job', 'my angle')
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toEqual({
      state: 'done',
      test: {
        angle: 'my angle',
        verdict: 'Viewers want this.',
        direct: true,
        evidence: [
          { text: 'They ask.', count: 8 },
          { text: 'Also.', count: null },
          { text: 'three', count: null },
        ],
        notes: 'a b',
      },
    })
    expect(jobPoll).toHaveBeenCalledTimes(2)
  })

  it('says so when nothing is direct evidence', async () => {
    poll({ status: 'completed', result: {} })
    vi.useFakeTimers()
    const pending = awaitNicheTest('job', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(await pending).toEqual({
      state: 'done',
      test: {
        angle: 'a',
        verdict: 'No verdict returned',
        direct: false,
        evidence: [],
        notes: '',
      },
    })
  })

  it.each([
    ['null', null],
    ['a string', 'done'],
    ['null notes', { notes: null }],
  ])(
    'gives no verdict and no evidence for a completed result that is %s',
    async (_name, result) => {
      poll({ status: 'completed', result })
      vi.useFakeTimers()
      const pending = awaitNicheTest('job', 'a')
      await vi.advanceTimersByTimeAsync(0)
      expect(await pending).toEqual({
        state: 'done',
        test: {
          angle: 'a',
          verdict: 'No verdict returned',
          direct: false,
          evidence: [],
          notes: '',
        },
      })
    },
  )

  it('says the job is still running when the wait times out', async () => {
    const jobPoll = vi
      .fn()
      .mockResolvedValue({ data: { status: 'inprogress' }, credits: 0, args: {} })
    spend.client = { ...mockVidiqClient(), jobPoll }
    vi.useFakeTimers()
    const pending = awaitNicheTest('job', 'a', { timeoutMs: 20_000, intervalMs: 5000 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await pending).toEqual({ state: 'running' })
    expect(jobPoll.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('says failed on a refunded failure', async () => {
    poll({ status: 'failed', refunded: true })
    vi.useFakeTimers()
    const pending = awaitNicheTest('job', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(await pending).toEqual({ state: 'failed' })
  })

  it('says failed when a poll has an unknown status', async () => {
    const { VidiqError } = await import('@boom-busters/providers/vidiq')
    spend.client = {
      ...mockVidiqClient(),
      jobPoll: () => Promise.reject(new VidiqError('vidiq_job_poll', 'unknown')),
    }
    vi.useFakeTimers()
    const pending = awaitNicheTest('job', 'a')
    await vi.advanceTimersByTimeAsync(0)
    expect(await pending).toEqual({ state: 'failed' })
  })
})

const completed = {
  verdict: 'Viewers want this.',
  directEvidence: [
    { summary: 'They ask.', threadCount: 8 },
    { quote: 'Also.' },
    { text: 'three' },
    { text: 'four' },
  ],
  notes: ['a', 'b'],
}

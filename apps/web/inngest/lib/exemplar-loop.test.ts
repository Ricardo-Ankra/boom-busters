// @vitest-environment node
import { MANIFEST, mockStoryboardPlan } from '@boom-busters/providers'
import { describe, expect, it, vi } from 'vitest'
import { CRITIC_CALL_MS, completeForJob, loopSlot } from './exemplar-loop'

const callLlm = vi.fn(async (..._args: unknown[]) => ({ text: '{}' }))
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
vi.mock('@/lib/db', () => ({ db: {} }))

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!

describe('the loop helpers (spec 2026-11-04, section 9.2)', () => {
  it("a job's call carries the channel, the job id and the technique in its meta", async () => {
    const complete = completeForJob('01J00000000000000000000CH1', 'job-1', 'stat-counter')
    await complete(
      { task: 'critic', system: 's', messages: [{ role: 'user', content: 'c' }], maxTokens: 10 },
      { purpose: 'critic' },
    )
    expect(callLlm.mock.calls[0]![1]).toMatchObject({
      channelId: '01J00000000000000000000CH1',
      purpose: 'critic',
      meta: { jobId: 'job-1', technique: 'stat-counter' },
    })
  })

  it("the critic's slot is the plan's, its words on the offset clock", () => {
    const plan = mockStoryboardPlan(stat)
    const slot = loopSlot(stat, plan)
    expect(slot.durationMs).toBe(stat.slot.durationMs)
    expect(slot.intent).toBe(plan.slot.intent)
    expect(slot.words[0]).toEqual({
      text: stat.slot.words[0]!.text,
      offsetMs: stat.slot.words[0]!.atMs,
    })
  })
})

describe('the critic call (decision 450)', () => {
  it('waits long enough to think over 16,000 tokens and still ends inside the 300 s step', () => {
    // Sonnet 5 wrote 5,500 tokens inside the old 120 s; 16,000 needs more.
    expect(CRITIC_CALL_MS).toBeGreaterThanOrEqual(200_000)
    expect(CRITIC_CALL_MS).toBeLessThanOrEqual(300_000 - 45_000)
  })
})

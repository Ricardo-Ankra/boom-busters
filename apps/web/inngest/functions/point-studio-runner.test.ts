// @vitest-environment node

import {
  chapters,
  claimPointWork,
  FIXTURE_PROJECT_ID,
  getShort,
  notices,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  setCredential,
  shorts,
  talkingPointSets,
  timelines,
  truncateRunMirror,
  updateChannelSettings,
  updateShort,
  updateWorkspace,
} from '@boom-busters/db'
import { truncateLedger } from '@boom-busters/cost'
import {
  FIRST_CHANNEL_ID,
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  teaserTextHash,
} from '@boom-busters/schemas'
import type * as Tts from '@/lib/tts'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { seedPointShort } from '@/lib/point-studio.fixture'
import { pointVoiceHash } from '../lib/point-build'
import { forgetRunRows } from '../middleware/run-mirror'
import { pointStudioRunner } from './point-studio-runner'

/**
 * The point Short studio's runner against the real database in mock-provider
 * mode: Re-voice buys only changed paragraphs and stores the voice; Re-plan
 * writes a new plan from the note over the stored voice and keeps that voice;
 * neither cuts; both give the Short's slot of work back, as words when the
 * work stopped.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  stillKey: vi.fn(),
  stockKey: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))
const spies = vi.hoisted(() => ({ synthesise: vi.fn() }))
vi.mock('@/lib/tts', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof Tts
  spies.synthesise.mockImplementation(actual.synthesise)
  return { ...actual, synthesise: spies.synthesise }
})
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('point-studio-runner', () => {
  let engine: InngestTestEngine
  let shortId: string

  const request = (op: 'voice' | 'plan', note: string | null = null) => ({
    events: [
      {
        name: 'shorts/point.studio.requested',
        data: { projectId: FIXTURE_PROJECT_ID, shortId, op, note },
      },
    ] as [{ name: string; data: Record<string, unknown> }],
  })
  const stored = async () => (await getShort(db, shortId))!
  const claim = (what: 'voice' | 'plan') =>
    claimPointWork(db, shortId, what, new Date(Date.now() - 10 * 60 * 1000))

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: pointStudioRunner })
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    await db.delete(notices)
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(talkingPointSets)
    await db.delete(chapters)
    await db.delete(scripts)
    await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    await setCredential(db, 'elevenlabs', 'xi-test-key-0000', env.SECRETS_ENCRYPTION_KEY)
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      tts: { provider: 'elevenlabs', voiceId: 'voice-a' },
    })
    shortId = (await seedPointShort()).shortId
  }, 120_000)

  /** Edit one paragraph's words on the stored script, as the studio's Save does. */
  async function editParagraph(index: number): Promise<string> {
    const script = PointScriptRecordSchema.parse((await stored()).pointScript)
    const text = `${script.paragraphs[index]!.text} Nobody asked about it.`
    await updateShort(db, shortId, {
      pointScript: {
        ...script,
        paragraphs: script.paragraphs.map((paragraph, at) =>
          at === index ? { ...paragraph, text } : paragraph,
        ),
      },
    })
    return text
  }

  it(
    'Re-voice buys only the changed paragraph and stores the voice, without cutting',
    { timeout: 120_000 },
    async () => {
      const before = await stored()
      const oldVoice = PointVoiceRecordSchema.parse(before.pointVoice)
      const last = oldVoice.paragraphs.length - 1
      const text = await editParagraph(last)
      expect(await claim('voice')).toBe(true)

      const { result } = await engine.execute(request('voice'))

      expect(result).toMatchObject({ outcome: 'voiced' })
      // One synthesis: the paragraph whose words changed.
      expect(spies.synthesise).toHaveBeenCalledTimes(1)
      const after = await stored()
      const voice = PointVoiceRecordSchema.parse(after.pointVoice)
      expect(voice.paragraphs).toHaveLength(oldVoice.paragraphs.length)
      expect(voice.paragraphs.slice(0, last)).toEqual(oldVoice.paragraphs.slice(0, last))
      expect(voice.paragraphs[last]!.textHash).toBe(teaserTextHash(text))
      // The slot of work is given back, and nothing was cut or queued to render.
      expect(PointFetchesRecordSchema.parse(after.pointFetches).state).toBeNull()
      expect(after.sourceTimeline).toEqual(before.sourceTimeline)
    },
  )

  it(
    'Re-voice of the first paragraph buys that one and keeps every later paragraph stored',
    { timeout: 120_000 },
    async () => {
      const oldVoice = PointVoiceRecordSchema.parse((await stored()).pointVoice)
      expect(oldVoice.paragraphs.length).toBeGreaterThan(2)
      await editParagraph(0)
      expect(await claim('voice')).toBe(true)

      await engine.execute(request('voice'))
      expect(spies.synthesise).toHaveBeenCalledTimes(1)

      // The stored voice is full length again, so a second Re-voice buys nothing.
      const voice = PointVoiceRecordSchema.parse((await stored()).pointVoice)
      expect(voice.paragraphs).toHaveLength(oldVoice.paragraphs.length)
      expect(voice.paragraphs.slice(1)).toEqual(oldVoice.paragraphs.slice(1))
      spies.synthesise.mockClear()
      expect(await claim('voice')).toBe(true)
      await engine.execute(request('voice'))
      expect(spies.synthesise).not.toHaveBeenCalled()
    },
  )

  it('Re-voice with nothing changed buys nothing', { timeout: 120_000 }, async () => {
    expect(await claim('voice')).toBe(true)

    const { result } = await engine.execute(request('voice'))

    expect(result).toMatchObject({ outcome: 'voiced' })
    expect(spies.synthesise).not.toHaveBeenCalled()
  })

  it(
    'Re-plan writes a new plan from the note over the same voice and keeps the voice',
    { timeout: 120_000 },
    async () => {
      const before = await stored()
      const voice = PointVoiceRecordSchema.parse(before.pointVoice)
      // An old plan made for another voice: the runner must replace it.
      const stale = PointPlanRecordSchema.parse(before.pointPlan)
      await updateShort(db, shortId, {
        pointPlan: {
          ...stale,
          shots: stale.shots.slice(0, 3),
          plannedFor: { scriptVersion: 1, voiceHash: 'an-older-voice' },
        },
      })
      expect(await claim('plan')).toBe(true)

      const { result } = await engine.execute(request('plan', 'more footage, fewer headlines'))

      expect(result).toMatchObject({ outcome: 'planned' })
      const after = await stored()
      const plan = PointPlanRecordSchema.parse(after.pointPlan)
      expect(plan.shots.length).toBeGreaterThan(3)
      expect(plan.plannedFor).toEqual({ scriptVersion: 1, voiceHash: pointVoiceHash(voice) })
      // Every shot is a full snapshot: the new pictures were fetched.
      expect(plan.shots.every((shot) => shot.slot !== null && shot.pending === null)).toBe(true)
      // The voice is kept as it was, not re-bought, and nothing was cut.
      expect(after.pointVoice).toEqual(before.pointVoice)
      expect(spies.synthesise).not.toHaveBeenCalled()
      expect(after.sourceTimeline).toEqual(before.sourceTimeline)
      const pool = PointFetchesRecordSchema.parse(after.pointFetches)
      expect(pool.state).toBeNull()
      expect(pool.candidates.length).toBeGreaterThanOrEqual(
        PointFetchesRecordSchema.parse(before.pointFetches).candidates.length,
      )
    },
  )

  it(
    'says in words, on the Short, when a paragraph cannot be voiced',
    { timeout: 120_000 },
    async () => {
      await editParagraph(0)
      expect(await claim('voice')).toBe(true)
      spies.synthesise.mockRejectedValueOnce(new Error('the voice vendor refused that text'))

      const { result } = await engine.execute(request('voice'))

      expect(result).toMatchObject({ outcome: 'skipped' })
      const state = PointFetchesRecordSchema.parse((await stored()).pointFetches).state
      expect(state).toMatchObject({ state: 'failed', what: 'voice' })
      expect(state?.state === 'failed' ? state.reason : '').toMatch(
        /paragraph 1 could not be synthesised/,
      )
    },
  )

  it('Re-plan without a stored voice stops in words', { timeout: 120_000 }, async () => {
    await updateShort(db, shortId, { pointVoice: null })
    expect(await claim('plan')).toBe(true)

    const { result } = await engine.execute(request('plan'))

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(PointFetchesRecordSchema.parse((await stored()).pointFetches).state).toMatchObject({
      state: 'failed',
      what: 'plan',
    })
  })
})

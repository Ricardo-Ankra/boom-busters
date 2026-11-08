// @vitest-environment node

import {
  channelExemplars,
  costLedger,
  createDerivation,
  exemplarVersionById,
  getDerivation,
  insertMotionReference,
  listChannelExemplars,
  motionDerivations,
  motionReferences,
  requireTestDatabase,
  seed,
  setReferenceReading,
  truncateRunMirror,
  upsertChannelAsset,
} from '@boom-busters/db'
import { DESIGNS, MANIFEST, mockGraphicCode, mockStoryboardPlan } from '@boom-busters/providers'
import { CRITIC_AXES, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import type { CriticReport } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { derivedContext } from '@/lib/exemplar-derive'
import type * as Cost from '@boom-busters/cost'
import type * as Frames from '@/lib/graphic-code/frames'
import { forgetRunRows } from '../middleware/run-mirror'
import { motionDerivationCancelled, motionExemplarDeriver } from './motion-exemplar-deriver'

/**
 * The deriver against the real database (spec 2026-11-04, section 9.2):
 * mock mode stores the house design as a playable draft with the fixture
 * report and a ready verdict; the real path, with the model and the browser
 * stubbed, runs the loop a step per call under the cap.
 */

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

let storageOn = false
const putObject = vi.fn(async (key: string, _body?: Buffer, _type?: string) => ({ key }))
vi.mock('@/lib/storage', () => ({
  R2_PREFIX: 'boom-busters',
  storageConfigured: () => storageOn,
  getObjectBytes: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: 'image/jpeg' })),
  putObject: (key: string, body: Buffer, type: string) => putObject(key, body, type),
}))
vi.mock('@/lib/reference-images', () => ({
  MODEL_IMAGE_MAX_WIDTH: 1600,
  imageForModel: async () => ({ mimeType: 'image/jpeg', data: 'AAAA' }),
}))
vi.mock('@/lib/critic-references', () => ({
  CRITIC_REFERENCES_MAX: 2,
  criticReferencesFor: async () => [],
}))

// The browser: a stub whose answers each test sets; off unless a test turns it on.
const inspect = vi.fn<Frames.GraphicFrames['inspect']>()
vi.mock('@/lib/graphic-code/frames', async (importOriginal) => ({
  ...(await importOriginal<typeof Frames>()),
  browserFrames: () => ({ inspect }),
}))
// The measured motion: the stub's shots are not JPEGs, so the numbers are given.
const metrics = {
  frozenMs: 0,
  longestFrozenMs: 0,
  frozenCritical: false,
  simultaneity: 0.2,
  holdAfterLastMs: 500,
  speedProfile: [],
}
vi.mock('@/lib/graphic-code/motion-metrics', () => ({ motionMetrics: async () => metrics }))

// The job's spend so far: nothing unless a test raises it.
const jobSpend = vi.fn(async () => 0)
vi.mock('@boom-busters/cost', async (importOriginal) => ({
  ...(await importOriginal<typeof Cost>()),
  jobSpendUsd: () => jobSpend(),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const highlight = MANIFEST.find((entry) => entry.id === 'text-highlight')!
const SHOT = { orientation: 'landscape' as const, atMs: 900, jpeg: 'AAAA' }
const photographed = (): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [SHOT, { ...SHOT, orientation: 'portrait' }],
  dense: [SHOT, { ...SHOT, atMs: 950 }],
  sheets: { landscape: 'SHEET', portrait: 'SHEET' },
  findings: [],
})
const framed = (): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [],
  dense: [],
  sheets: {},
  findings: [],
})

const report = (patch: Partial<CriticReport> = {}) => ({
  text: JSON.stringify({
    scores: Object.fromEntries(CRITIC_AXES.map((axis) => [axis, { score: 8, line: 'fine' }])),
    defects: [],
    fixes: [],
    mechanisms: [],
    keep: true,
    ...patch,
  }),
})
const prefers = (value: 'A' | 'B' | 'same') =>
  Object.fromEntries(CRITIC_AXES.map((axis) => [axis, value]))

/** A design the checks pass for the mock plan's slot. */
const design = (entry = stat) => {
  const plan = mockStoryboardPlan(entry)
  const context = derivedContext(entry, plan)
  return {
    text: JSON.stringify(
      mockGraphicCode({
        claimTexts: context.claims.map((claim) => claim.text),
        intentRefs: [1],
        durationMs: entry.slot.durationMs,
      }),
    ),
  }
}
const storyboard = (entry = stat) => ({ text: JSON.stringify(mockStoryboardPlan(entry)) })
const under = Object.fromEntries(CRITIC_AXES.map((axis) => [axis, { score: 6, line: 'low' }]))

describeDb('motion-exemplar-deriver', () => {
  let engine: InngestTestEngine

  const launch = async (
    techniques: ('stat-counter' | 'bar-chart' | 'text-highlight')[],
    rounds = 1,
    capUsd = 5,
    propose = false,
  ) => {
    const row = await createDerivation(db, {
      channelId: FIRST_CHANNEL_ID,
      techniques,
      rounds,
      capUsd,
      propose,
    })
    const { result } = await engine.execute({
      events: [
        {
          name: 'motion/exemplars.derive',
          data: { channelId: FIRST_CHANNEL_ID, derivationId: row.id },
        },
      ],
    })
    return { row, result, after: (await getDerivation(db, row.id))! }
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    vi.stubEnv('GRAPHIC_FRAMES', 'off')
    engine = new InngestTestEngine({ function: motionExemplarDeriver })
    callLlm.mockReset()
    inspect.mockReset()
    putObject.mockClear()
    jobSpend.mockReset().mockResolvedValue(0)
    storageOn = false
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(channelExemplars)
    await db.delete(motionDerivations)
    await db.delete(motionReferences)
    await db.delete(costLedger)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  /** A mechanism reference, read, on the first channel (spec 8.5): what a proposal is made from. */
  const aMechanismReference = async () => {
    const asset = await upsertChannelAsset(db, FIRST_CHANNEL_ID, {
      kind: 'video',
      r2Key: 'boom-busters/references/first/ledger.mp4',
      contentHash: `hash-${Date.now()}`,
      width: 1920,
      height: 1080,
      durationMs: 4000,
      title: 'Ledger scene',
    })
    const row = await insertMotionReference(db, FIRST_CHANNEL_ID, {
      assetId: asset!.id,
      kind: 'video',
      title: 'Ledger scene',
      sourceUrl: null,
      rights: 'Reference only',
      purpose: 'mechanism',
      negative: false,
      windowStartMs: 0,
      windowEndMs: 2000,
      carryOver: 'the ruled line that wipes the old figure away',
      avoid: '',
      frames: { dense: [], overview: [] },
    })
    await setReferenceReading(db, row.id, {
      medium: 'flat typography over paper',
      palette: ['#111'],
      type: 'grotesk, heavy',
      enters: 'written in',
      exits: 'wiped by a rule',
      motion: 'one line travels and the figure behind it changes',
      absent: 'no glow',
      notes: '',
      readAt: '2026-11-04T00:00:00.000Z',
      model: 'test/model',
    })
    return row
  }

  describe("a technique of the channel's own (spec 8.5)", () => {
    it('proposes a technique in mock mode, derives it under the new key and marks it in the row', async () => {
      await aMechanismReference()
      const { result, after } = await launch([], 1, 5, true)
      expect(result).toMatchObject({ outcome: 'done' })
      expect(after.proposal).toEqual({ state: 'proposed', technique: 'mock-move', reason: null })
      expect(after.progress).toHaveLength(1)
      expect(after.progress[0]).toMatchObject({ technique: 'mock-move', state: 'ready' })
      const [version] = await listChannelExemplars(db, FIRST_CHANNEL_ID)
      expect(version?.technique).toBe('mock-move')
      expect(version?.proposal?.steerPhrases).toEqual(['mock move'])
      expect(version?.proposal?.fromReference).toBe('Ledger scene')
      expect(version?.code.title).toBe(DESIGNS['kinetic-word-stack']!.title)
      expect(version?.status).toBe('draft')
      expect(callLlm).not.toHaveBeenCalled()
    })

    it('records none when no mechanism reference is read and still derives the ticked techniques', async () => {
      const { after } = await launch(['stat-counter'], 1, 5, true)
      expect(after.proposal?.state).toBe('none')
      expect(after.proposal?.technique).toBeNull()
      expect(after.proposal?.reason).toMatch(/^\[mock\]/)
      expect(after.progress).toEqual([
        expect.objectContaining({ technique: 'stat-counter', state: 'ready' }),
      ])
      expect(after.state).toBe('done')
    })

    it('fails the proposal after one retry and still derives the ticked techniques', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      vi.stubEnv('GRAPHIC_FRAMES', 'off')
      await aMechanismReference()
      const taken = {
        text: JSON.stringify({
          proposal: {
            key: 'stat-counter',
            name: 'Stat counter',
            description: 'a counter',
            steerPhrases: ['ledger wipe'],
            mechanisms: ['drum'],
            slot: { durationMs: 6000, words: [{ text: 'one', atMs: 0 }], intent: 'i' },
            fromReference: 'Ledger scene',
          },
          why: 'a move',
        }),
      }
      callLlm
        .mockResolvedValueOnce(taken)
        .mockResolvedValueOnce(taken)
        .mockResolvedValueOnce(storyboard())
        .mockResolvedValueOnce(design())
      const { after } = await launch(['stat-counter'], 1, 5, true)
      expect(after.proposal?.state).toBe('failed')
      expect(after.proposal?.reason).toMatch(/already a technique/)
      expect(callLlm).toHaveBeenCalledTimes(4)
      expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
        'The previous proposal was refused',
      )
      expect(after.progress).toEqual([
        expect.objectContaining({ technique: 'stat-counter', state: 'no-frames' }),
      ])
    })
  })

  it('derives every technique in mock mode as a playable draft with the mock report and a ready verdict', async () => {
    const { result, after } = await launch(['stat-counter', 'bar-chart'])
    expect(result).toMatchObject({ outcome: 'done' })
    const versions = await listChannelExemplars(db, FIRST_CHANNEL_ID)
    expect(versions.map((row) => [row.technique, row.version, row.status])).toEqual([
      ['bar-chart', 1, 'draft'],
      ['stat-counter', 1, 'draft'],
    ])
    const stored = versions.find((row) => row.technique === 'stat-counter')!
    expect(stored.plan.concept).toBe('[mock] the house design, unchanged')
    expect(stored.code.compiled.length).toBeGreaterThan(0)
    expect(stored.critique?.scores.craft.score).toBe(8)
    expect(stored.verify?.verdict).toBe('ready')
    expect(stored.frames).toBeNull()
    expect(stored.derivationId).toBe(after.id)
    expect(after.state).toBe('done')
    expect(after.progress.every((entry) => entry.state === 'ready')).toBe(true)
    expect(callLlm).not.toHaveBeenCalled()
  })

  it("writes the progress per technique and the derivation's state and spend", async () => {
    jobSpend.mockResolvedValue(0.75)
    const { after } = await launch(['stat-counter'])
    expect(after.progress[0]).toMatchObject({ technique: 'stat-counter', state: 'ready' })
    expect(after.progress[0]!.versionId).not.toBeNull()
    expect(after.spentUsd).toBe('0.7500')
    expect(after.finishedAt).toBeInstanceOf(Date)
  })

  it('marks the derivation stopped when its run is cancelled outside the app (final review, issue 1)', async () => {
    const row = await createDerivation(db, {
      channelId: FIRST_CHANNEL_ID,
      techniques: ['stat-counter'],
      rounds: 1,
      capUsd: 5,
    })
    const cancelled = new InngestTestEngine({ function: motionDerivationCancelled })
    const { result } = await cancelled.execute({
      events: [
        {
          name: 'inngest/function.cancelled',
          data: {
            run_id: '01RUN',
            function_id: 'motion-exemplar-deriver',
            event: {
              name: 'motion/exemplars.derive',
              data: { channelId: FIRST_CHANNEL_ID, derivationId: row.id },
            },
          },
        },
      ],
    })
    expect(result).toMatchObject({ outcome: 'stopped', derivationId: row.id })
    const after = (await getDerivation(db, row.id))!
    expect(after.state).toBe('stopped')
    expect(after.error).toBe('Cancelled outside the app (the Inngest dashboard, or the API)')
    expect(after.finishedAt).toBeInstanceOf(Date)
    const other = await cancelled.execute({
      events: [
        { name: 'inngest/function.cancelled', data: { run_id: 'x', function_id: 'script-runner' } },
      ],
    })
    expect(other.result).toMatchObject({ outcome: 'not-ours' })
  })

  it('runs one derivation per channel at a time', () => {
    const opts = (motionExemplarDeriver as unknown as { opts: Record<string, unknown> }).opts
    expect(opts['singleton']).toEqual({ key: 'event.data.channelId', mode: 'cancel' })
  })

  it('stops the technique at the cap with what it has and skips the rest', async () => {
    // Nothing spent until the build is stored; then the cap is crossed.
    // The start, the storyboard and the build see nothing spent; the critic sees the cap crossed.
    jobSpend
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(5.2)
    const { after } = await launch(['stat-counter', 'bar-chart'], 1, 5)
    expect(after.state).toBe('stopped')
    const [first, second] = after.progress
    expect(first).toMatchObject({ technique: 'stat-counter', state: 'stopped-at-cap' })
    expect(first!.reason).toBe('The cap of $5 was reached at $5.20')
    expect(first!.versionId).not.toBeNull()
    const kept = await exemplarVersionById(db, first!.versionId!)
    expect(kept?.status).toBe('draft')
    expect(kept?.critique).toBeNull()
    expect(second).toMatchObject({
      technique: 'bar-chart',
      state: 'stopped-at-cap',
      versionId: null,
    })
  })

  describe('the real path, the model and the browser stubbed', () => {
    beforeEach(() => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      vi.stubEnv('GRAPHIC_FRAMES', '')
      storageOn = true
      inspect.mockResolvedValue(framed())
    })

    it("fails the technique with the storyboard's reason after one retry", async () => {
      const late = {
        ...mockStoryboardPlan(stat),
        slot: { intent: 'x', words: [{ text: 'late', atMs: 6000 }] },
      }
      callLlm.mockResolvedValue({ text: JSON.stringify(late) })
      const { after } = await launch(['stat-counter'])
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
        "a word sits past the slot's end",
      )
      expect(after.progress[0]).toMatchObject({ state: 'failed', versionId: null })
      expect(after.progress[0]!.reason).toContain("a word sits past the slot's end")
      expect(await listChannelExemplars(db, FIRST_CHANNEL_ID)).toHaveLength(0)
    })

    it('stores a playable draft and skips the critic when there are no frames', async () => {
      vi.stubEnv('GRAPHIC_FRAMES', 'off')
      callLlm.mockResolvedValueOnce(storyboard()).mockResolvedValueOnce(design())
      const { after } = await launch(['stat-counter'])
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect(after.progress[0]).toMatchObject({ state: 'no-frames', reason: 'no frames to show' })
      const version = await exemplarVersionById(db, after.progress[0]!.versionId!)
      expect(version?.code.compiled.length).toBeGreaterThan(0)
      expect(version?.critique).toBeNull()
      expect(version?.verify).toBeNull()
    })

    it('stops early when the critic passes every axis in round one', async () => {
      inspect.mockResolvedValueOnce(framed()).mockResolvedValueOnce(photographed())
      callLlm
        .mockResolvedValueOnce(storyboard())
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce(report())
      const { after } = await launch(['stat-counter'], 2)
      // The storyboard, the build, one critic round: no fix, no second round, and no
      // verify call either, since nothing changed after the critic (final review, issue 5).
      expect(callLlm).toHaveBeenCalledTimes(3)
      expect(callLlm.mock.calls[2]![0].task).toBe('critic')
      expect(callLlm.mock.calls[2]![1]).toMatchObject({
        purpose: 'critic',
        meta: { technique: 'stat-counter' },
      })
      expect(after.progress[0]).toMatchObject({ state: 'ready' })
      const version = await exemplarVersionById(db, after.progress[0]!.versionId!)
      expect(version?.verify?.verdict).toBe('ready')
      expect(version?.frames?.sheets.landscape).toMatch(/round-1\/landscape-sheet\.jpg$/)
      expect(version?.metrics?.simultaneity).toBe(0.2)
      expect(putObject).toHaveBeenCalled()
    })

    it('asks the pairwise question twice from round two and records a flip as a tie', async () => {
      inspect
        .mockResolvedValueOnce(framed())
        .mockResolvedValueOnce(photographed())
        .mockResolvedValueOnce(framed())
        .mockResolvedValueOnce(photographed())
      callLlm
        .mockResolvedValueOnce(storyboard())
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce(
          report({ keep: false, fixes: ['bigger type'], scores: under as never }),
        )
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce({
          text: JSON.stringify({ ...JSON.parse(report().text), prefers: prefers('A') }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({ prefers: { ...prefers('A'), craft: 'B' } }),
        })
      const { after } = await launch(['stat-counter'], 2)
      // The second critic passed, so no fix and no verify call followed it.
      expect(callLlm).toHaveBeenCalledTimes(6)
      const second = callLlm.mock.calls[4]![0]
      expect(second.messages.at(-1).content).toContain('Previous version (B)')
      const swapped = callLlm.mock.calls[5]![0]
      expect(swapped.messages).toHaveLength(2)
      expect(callLlm.mock.calls[5]![1]).toMatchObject({ purpose: 'pairwise' })
      const version = await exemplarVersionById(db, after.progress[0]!.versionId!)
      // A on both asks is a flip on every axis but craft, where the swap agreed on the new version.
      expect(version?.pairwise?.engagement).toBe('tie')
      expect(version?.pairwise?.craft).toBe('new')
      expect(version?.verify?.verdict).toBe('ready')
      expect(after.progress[0]).toMatchObject({ state: 'ready' })
    })

    it('fixes in the last round too, photographs the fix, and verifies it on the graphics route', async () => {
      inspect
        .mockResolvedValueOnce(framed())
        .mockResolvedValueOnce(photographed())
        .mockResolvedValueOnce(framed())
        .mockResolvedValueOnce(photographed())
      callLlm
        .mockResolvedValueOnce(storyboard())
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce(
          report({ keep: false, fixes: ['bigger type'], scores: under as never }),
        )
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce({
          text: JSON.stringify({ ...JSON.parse(report().text), verdict: 'ready' }),
        })
      const { after } = await launch(['stat-counter'], 1)
      // The storyboard, the build, the critic, the fix of that last round, the verify on the fix's frames.
      expect(callLlm).toHaveBeenCalledTimes(5)
      expect(callLlm.mock.calls[3]![0].messages.at(-1).content).toContain(
        "The critic's fixes, in order: 1. bigger type",
      )
      const [verify, options] = callLlm.mock.calls[4]!
      expect(verify.task).toBe('graphics')
      expect(verify.messages.at(-1).content).toContain('This is a verify round.')
      expect(options).toMatchObject({ purpose: 'verify' })
      expect(inspect).toHaveBeenCalledTimes(4)
      const version = await exemplarVersionById(db, after.progress[0]!.versionId!)
      expect(version?.frames?.round).toBe(2)
      expect(after.progress[0]).toMatchObject({ state: 'ready' })
    })

    it('contains a malformed critic reply to its technique and derives the next (final review, issue 6)', async () => {
      inspect
        .mockResolvedValueOnce(framed())
        .mockResolvedValueOnce(photographed())
        .mockResolvedValueOnce(framed())
      callLlm
        .mockResolvedValueOnce(storyboard())
        .mockResolvedValueOnce(design())
        .mockResolvedValueOnce({ text: 'not a report at all' })
        .mockResolvedValueOnce(storyboard(highlight))
        .mockResolvedValueOnce(design(highlight))
      const { after } = await launch(['stat-counter', 'text-highlight'], 1)
      const [first, second] = after.progress
      expect(first).toMatchObject({ technique: 'stat-counter', state: 'failed' })
      expect(first!.reason).toMatch(/malformed/i)
      expect(first!.versionId).not.toBeNull()
      expect((await exemplarVersionById(db, first!.versionId!))?.status).toBe('draft')
      expect(second!.technique).toBe('text-highlight')
      expect(second!.versionId).not.toBeNull()
      expect(after.state).toBe('done')
    })

    it('marks a technique failed when its call throws and derives the next', async () => {
      vi.stubEnv('GRAPHIC_FRAMES', 'off')
      callLlm
        .mockRejectedValueOnce(new Error('provider down'))
        .mockResolvedValueOnce(storyboard(highlight))
        .mockResolvedValueOnce(design(highlight))
      const { after } = await launch(['stat-counter', 'text-highlight'], 1)
      const [first, second] = after.progress
      expect(first).toMatchObject({ technique: 'stat-counter', state: 'failed', versionId: null })
      expect(first!.reason).toContain('provider down')
      expect(second).toMatchObject({ technique: 'text-highlight', state: 'no-frames' })
    })
  })
})

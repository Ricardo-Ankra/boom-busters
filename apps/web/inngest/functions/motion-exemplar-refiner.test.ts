// @vitest-environment node

import {
  approveExemplarVersion,
  channelExemplars,
  costLedger,
  insertExemplarVersion,
  listChannelExemplars,
  requireTestDatabase,
  seed,
  truncateRunMirror,
  updateExemplarDraft,
} from '@boom-busters/db'
import { MANIFEST, mockGraphicCode, mockStoryboardPlan } from '@boom-busters/providers'
import { CRITIC_AXES, FIRST_CHANNEL_ID, newId } from '@boom-busters/schemas'
import type { CriticReport, GraphicCode } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { derivedContext, derivedSlot } from '@/lib/exemplar-derive'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import type * as Frames from '@/lib/graphic-code/frames'
import { forgetRunRows } from '../middleware/run-mirror'
import { motionExemplarRefiner } from './motion-exemplar-refiner'

/**
 * The refiner against the real database (spec 2026-11-04, section 9.3):
 * one build from the parent under the steer, one verify round against the
 * parent, a new draft with the parent and the steer; nothing when the
 * build is refused but a heads-up.
 */

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
const notify = vi.fn()
vi.mock('@/lib/notify', () => ({ notify: (...args: unknown[]) => notify(...args) }))

let storageOn = false
vi.mock('@/lib/storage', () => ({
  R2_PREFIX: 'boom-busters',
  storageConfigured: () => storageOn,
  getObjectBytes: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: 'image/jpeg' })),
  putObject: vi.fn(async (key: string) => ({ key })),
}))
vi.mock('@/lib/reference-images', () => ({
  MODEL_IMAGE_MAX_WIDTH: 1600,
  imageForModel: async () => ({ mimeType: 'image/jpeg', data: 'AAAA' }),
}))
vi.mock('@/lib/critic-references', () => ({
  CRITIC_REFERENCES_MAX: 2,
  criticReferencesFor: async () => [],
}))
const inspect = vi.fn<Frames.GraphicFrames['inspect']>()
vi.mock('@/lib/graphic-code/frames', async (importOriginal) => ({
  ...(await importOriginal<typeof Frames>()),
  browserFrames: () => ({ inspect }),
}))
vi.mock('@/lib/graphic-code/motion-metrics', () => ({
  motionMetrics: async () => ({
    frozenMs: 0,
    longestFrozenMs: 0,
    frozenCritical: false,
    simultaneity: 0.2,
    holdAfterLastMs: 500,
    speedProfile: [],
  }),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const SHOT = { orientation: 'landscape' as const, atMs: 900, jpeg: 'AAAA' }
const photographed = (): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [SHOT],
  dense: [SHOT],
  sheets: { landscape: 'SHEET' },
  findings: [],
})
const framed = (): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [],
  dense: [],
  sheets: {},
  findings: [],
})
const report = (patch: Partial<CriticReport> & { verdict?: string } = {}) => ({
  text: JSON.stringify({
    scores: Object.fromEntries(CRITIC_AXES.map((axis) => [axis, { score: 8, line: 'fine' }])),
    defects: [],
    fixes: [],
    mechanisms: [],
    keep: true,
    ...patch,
  }),
})
const plan = mockStoryboardPlan(stat)
const context = derivedContext(stat, plan)
const slot = derivedSlot(stat, plan, context)
const planned = () =>
  mockGraphicCode({
    claimTexts: context.claims.map((claim) => claim.text),
    intentRefs: [1],
    durationMs: stat.slot.durationMs,
  })
/** The parent's code: the fixture through the checks, as a stored design is. */
const parentCode = (): GraphicCode => {
  const checked = graphicCodeIssue(planned(), context, {
    brief: slot.brief,
    durationMs: slot.durationMs,
    words: plan.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
  })
  if (!('code' in checked)) throw new Error(checked.issue)
  return checked.code
}

describeDb('motion-exemplar-refiner', () => {
  let engine: InngestTestEngine

  const aParent = async (approve = true) => {
    const row = await insertExemplarVersion(db, {
      channelId: FIRST_CHANNEL_ID,
      technique: 'stat-counter',
      plan,
      code: parentCode(),
    })
    await updateExemplarDraft(db, row.id, {
      critique: JSON.parse(
        report({ defects: [{ atMs: 900, orientation: 'landscape', text: 'the label clips' }] })
          .text,
      ),
      frames: { shots: [], sheets: { landscape: 'sheets/parent.jpg' }, round: 1 },
    })
    if (approve) await approveExemplarVersion(db, row.id)
    return row
  }

  const refine = async (parentId: string, steer = 'slower') => {
    const { result } = await engine.execute({
      events: [
        {
          name: 'motion/exemplar.refine',
          data: { channelId: FIRST_CHANNEL_ID, parentId, steer },
        },
      ],
    })
    return result
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    vi.stubEnv('GRAPHIC_FRAMES', 'off')
    engine = new InngestTestEngine({ function: motionExemplarRefiner })
    callLlm.mockReset()
    notify.mockReset()
    inspect.mockReset()
    storageOn = false
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(channelExemplars)
    await db.delete(costLedger)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('refines in mock mode into a draft with the parent and the steer', async () => {
    const parent = await aParent()
    const result = await refine(parent.id, 'slower, darker')
    expect(result).toMatchObject({ outcome: 'refined' })
    const versions = await listChannelExemplars(db, FIRST_CHANNEL_ID)
    expect(versions).toHaveLength(2)
    const draft = versions.find((row) => row.id !== parent.id)!
    expect(draft).toMatchObject({
      status: 'draft',
      version: 2,
      parentId: parent.id,
      steer: 'slower, darker',
    })
    expect(draft.code.title).toMatch(/^\[mock\] Refined:/)
    expect(draft.verify?.verdict).toBe('ready')
    expect(draft.critique?.scores.craft.score).toBe(8)
    expect(callLlm).not.toHaveBeenCalled()
    expect(
      (await listChannelExemplars(db, FIRST_CHANNEL_ID)).find((row) => row.id === parent.id)
        ?.status,
    ).toBe('approved')
  })

  it('ends when the parent is gone', async () => {
    const result = await refine(newId())
    expect(result).toMatchObject({ outcome: 'gone' })
    expect(await listChannelExemplars(db, FIRST_CHANNEL_ID)).toHaveLength(0)
  })

  it('runs one refine per channel at a time', () => {
    const opts = (motionExemplarRefiner as unknown as { opts: Record<string, unknown> }).opts
    expect(opts['singleton']).toEqual({ key: 'event.data.channelId', mode: 'cancel' })
  })

  describe('the real path, the model and the browser stubbed', () => {
    beforeEach(() => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      vi.stubEnv('GRAPHIC_FRAMES', '')
      storageOn = true
    })

    it('a refused build inserts nothing and leaves a heads-up', async () => {
      const parent = await aParent()
      callLlm.mockResolvedValue({
        text: JSON.stringify({ ...planned(), source: 'import x from "y"' }),
      })
      const result = await refine(parent.id)
      expect(result).toMatchObject({ outcome: 'refused' })
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect(await listChannelExemplars(db, FIRST_CHANNEL_ID)).toHaveLength(1)
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify.mock.calls[0]![0]).toMatchObject({ kind: 'heads-up', title: 'Refine refused' })
    })

    it("verifies against the parent's sheets with the steer as the brief", async () => {
      const parent = await aParent()
      inspect.mockResolvedValueOnce(framed()).mockResolvedValueOnce(photographed())
      callLlm.mockResolvedValueOnce({ text: JSON.stringify(planned()) }).mockResolvedValueOnce({
        text: JSON.stringify({
          ...JSON.parse(report().text),
          prefers: Object.fromEntries(CRITIC_AXES.map((axis) => [axis, 'A'])),
          priorDefects: [{ index: 1, state: 'fixed' }],
          verdict: 'ready',
        }),
      })
      const result = await refine(parent.id, 'slower')
      expect(result).toMatchObject({ outcome: 'refined' })
      expect(callLlm).toHaveBeenCalledTimes(2)
      const [build, buildOptions] = callLlm.mock.calls[0]!
      expect(build.messages.at(-1).content).toContain("The producer's steer: slower")
      expect(build.messages.at(-1).content).toContain(
        'What the steer does not name is kept exactly as it is.',
      )
      expect(buildOptions).toMatchObject({ meta: { technique: 'stat-counter' } })
      const [verify, verifyOptions] = callLlm.mock.calls[1]!
      expect(verify.task).toBe('critic')
      const ask = verify.messages.at(-1).content
      expect(ask).toContain('Previous version (B)')
      expect(ask).toContain("This is a verify round. The producer's steer: slower")
      expect(ask).toContain('1. at 0.9 s in landscape: the label clips')
      expect(verifyOptions).toMatchObject({ purpose: 'verify' })
      const draft = (await listChannelExemplars(db, FIRST_CHANNEL_ID)).find(
        (row) => row.id !== parent.id,
      )!
      expect(draft.parentId).toBe(parent.id)
      expect(draft.verify?.priorDefects).toEqual([{ index: 1, state: 'fixed' }])
      expect(draft.pairwise?.craft).toBe('new')
      expect(draft.frames?.round).toBe(1)
      expect(draft.metrics?.simultaneity).toBe(0.2)
    })
  })
})

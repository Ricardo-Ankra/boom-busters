// @vitest-environment node
import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { exemplarFor, mockStoryboardPlan } from '@boom-busters/providers'
import {
  DEFAULT_MOTION_IDENTITY,
  DEFAULT_SETTINGS,
  EXEMPLAR_STEER_MAX,
  resolveBrandKit,
} from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkHandDesign,
  handEntry,
  parseHandFiles,
  revisionOf,
  type RevisionCandidate,
} from './exemplar-hand'
import { FramesUnavailable } from './graphic-code/frames'
import type * as Frames from './graphic-code/frames'
import type * as MotionMetricsModule from './graphic-code/motion-metrics'

// The stub's shots are not JPEGs, so the measured motion is given.
const motionMetrics = vi.fn<typeof MotionMetricsModule.motionMetrics>()
vi.mock('./graphic-code/motion-metrics', () => ({
  motionMetrics: (...args: Parameters<typeof MotionMetricsModule.motionMetrics>) =>
    motionMetrics(...args),
}))

const inspect = vi.fn<Frames.GraphicFrames['inspect']>()
const frames: Frames.GraphicFrames = { inspect: (input) => inspect(input) }
const framed = (over: Partial<Frames.FramesResult>): Frames.FramesResult => ({
  layoutIssue: null,
  shots: [],
  findings: [],
  dense: [],
  sheets: {},
  ...over,
})
const shot = { orientation: 'landscape' as const, atMs: 4950, jpeg: 'AAAA' }

const entry = handEntry('lower-third')
const house = exemplarFor('lower-third')!
const files = () =>
  parseHandFiles({
    plan: mockStoryboardPlan(entry),
    source: house.source,
    title: house.title,
    facts: [],
  })
const run = () =>
  checkHandDesign({
    entry,
    ...files(),
    motion: DEFAULT_MOTION_IDENTITY,
    brand: graphicBrand(resolveBrandKit(DEFAULT_SETTINGS)),
    frames,
  })

beforeEach(() => {
  inspect.mockReset()
  motionMetrics.mockReset()
  motionMetrics.mockResolvedValue(null)
})

describe('handEntry', () => {
  it('reads a house technique and refuses any other key', () => {
    expect(entry.technique).toBe('lower-third')
    expect(() => handEntry('a-channel-own')).toThrow(/not a house technique/)
  })
})

describe('parseHandFiles', () => {
  it("carries the plan's concept, storyboard and mechanisms onto the answer", () => {
    const { plan, answer } = files()
    expect(answer.concept).toBe(plan.concept)
    expect(answer.storyboard).toEqual(plan.storyboard)
    expect(answer.mechanisms).toEqual(plan.mechanisms)
    expect(answer.facts).toEqual([])
  })
})

describe('revisionOf', () => {
  const version = (over: Partial<RevisionCandidate>): RevisionCandidate => ({
    id: 'v1',
    channelId: 'bb',
    technique: 'typewriter',
    version: 1,
    status: 'draft',
    ...over,
  })
  const revise = (parentId: string, versions: RevisionCandidate[], steer: unknown = ' Type it. ') =>
    revisionOf({ channelId: 'bb', technique: 'typewriter', parentId, steer, versions })

  it("files the technique's latest draft as the parent, the steer trimmed", () => {
    const versions = [version({}), version({ id: 'other', technique: 'progress-bars' })]
    expect(revise('v1', versions)).toEqual({ parentId: 'v1', steer: 'Type it.' })
  })

  it('takes the approved version over any draft, as Refine does', () => {
    const versions = [version({ status: 'approved' }), version({ id: 'v2', version: 2 })]
    expect(revise('v1', versions)).toEqual({ parentId: 'v1', steer: 'Type it.' })
    expect(revise('v2', versions)).toEqual({ issue: 'revise the approved version, v1' })
  })

  it('refuses an older draft while a newer one waits', () => {
    const versions = [version({}), version({ id: 'v2', version: 2 })]
    expect(revise('v1', versions)).toEqual({ issue: 'revise the latest draft, v2' })
  })

  it("refuses another channel's version, another technique's and an unknown one", () => {
    expect(revise('v1', [version({ channelId: 'elsewhere' })])).toEqual({
      issue: 'this channel has no version v1',
    })
    expect(revise('v1', [version({ technique: 'lower-third' })])).toEqual({
      issue: 'version v1 is a lower-third, not a typewriter',
    })
    expect(revise('gone', [version({})])).toEqual({ issue: 'this channel has no version gone' })
  })

  it("refuses a steer the app's own schema would refuse", () => {
    const issue = `the steer is the owner's words, 1 to ${EXEMPLAR_STEER_MAX} characters`
    expect(revise('v1', [version({})], '   ')).toEqual({ issue })
    expect(revise('v1', [version({})], 'a'.repeat(EXEMPLAR_STEER_MAX + 1))).toEqual({ issue })
    // --parent without --steer: the flag is absent.
    const absent = revisionOf({
      channelId: 'bb',
      technique: 'typewriter',
      parentId: 'v1',
      steer: undefined,
      versions: [version({})],
    })
    expect(absent).toEqual({ issue })
  })
})

describe('checkHandDesign', () => {
  it("refuses a plan outside the catalogue slot's bounds before any check", async () => {
    const plan = mockStoryboardPlan(entry)
    plan.slot.words = [{ text: 'Late', atMs: entry.slot.durationMs }]
    const result = await checkHandDesign({
      entry,
      plan,
      answer: files().answer,
      motion: DEFAULT_MOTION_IDENTITY,
      brand: graphicBrand(resolveBrandKit(DEFAULT_SETTINGS)),
      frames,
    })
    expect(result).toEqual({ issue: "plan: a word sits past the slot's end" })
    expect(inspect).not.toHaveBeenCalled()
  })

  it("refuses what the designer's layout check would refuse", async () => {
    inspect.mockResolvedValue(framed({ layoutIssue: 'at 1.0 s in portrait, the name is cropped' }))
    expect(await run()).toEqual({ issue: 'layout: at 1.0 s in portrait, the name is cropped' })
  })

  it('refuses without a browser, since a hand-made version is kept only once looked at', async () => {
    inspect.mockRejectedValue(new FramesUnavailable('no chromium'))
    expect(await run()).toEqual({ issue: 'no browser: no chromium' })
  })

  it('passes a design the checks keep, photographed at the storyboard moments and evenly', async () => {
    inspect.mockImplementation(async (input) =>
      framed(input.shots ? { shots: [shot], sheets: { landscape: 'BBBB' } } : {}),
    )
    const result = await run()
    if ('issue' in result) throw new Error(result.issue)
    expect(result.code.title).toBe(house.title)
    expect(result.code.compiled).toContain('const motion')
    expect(result.shots).toEqual([shot])
    expect(result.sheets).toEqual({
      storyboard: { landscape: 'BBBB' },
      even: { landscape: 'BBBB' },
    })
    // The layout check, then the deriver's storyboard moments, then the even set.
    expect(inspect).toHaveBeenCalledTimes(3)
    expect(inspect.mock.calls[0]![0]).toMatchObject({ shots: false, measure: true })
    expect(inspect.mock.calls[2]![0].dense!.length).toBeGreaterThan(10)
  })
})

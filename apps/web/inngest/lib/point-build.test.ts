// @vitest-environment node

import { mockPointPlan, mockPointScript } from '@boom-busters/providers'
import {
  DEFAULT_SETTINGS,
  resolveBrandKit,
  teaserTextHash,
  TimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  PointPlanRecord,
  PointVoiceRecord,
  SlotCandidate,
  TalkingPoint,
  Timeline,
  TimelineSlot,
} from '@boom-busters/schemas'
import { layoutPointNarration } from '@boom-busters/timeline'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assemblePointShort,
  fetchPendingShots,
  planLibrary,
  pointParagraphAudio,
  pointParagraphIdempotencyKey,
  pointVoiceHash,
} from './point-build'

/**
 * The point Short's pure build steps: the numbered library, the picture
 * fetch's fallbacks and the assemble. The paid and stored steps run in the
 * runner's own test, against the database.
 */

const visualAssets = vi.hoisted(() => ({
  generateStillCandidates: vi.fn(),
  fetchStockCandidates: vi.fn(),
  requireVisualKeys: vi.fn(),
}))
vi.mock('@/lib/visual-assets', () => visualAssets)
const ingest = vi.hoisted(() => ({ ingestCandidateBytes: vi.fn() }))
vi.mock('@/lib/stock-ingest', () => ingest)

const CH_A = '01HQ0000000000000000000CH1'
const CH_B = '01HQ0000000000000000000CH2'

const imageSlot = (startMs: number, key: string): TimelineSlot => ({
  type: 'still',
  startMs,
  durationMs: 4000,
  transition: 'cut',
  motion: { kind: 'static' },
  payload: { kind: 'image', src: { r2Key: key } },
})

function master(): Timeline {
  return TimelineSchema.parse({
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      { r2Key: 'mock://a.wav', startMs: 0, durationMs: 8000, chapterId: CH_A, paragraphIndex: 0 },
      {
        r2Key: 'mock://b.wav',
        startMs: 8000,
        durationMs: 8000,
        chapterId: CH_B,
        paragraphIndex: 0,
      },
    ],
    music: null,
    captions: {
      style: 'karaoke',
      words: [
        { text: 'First', startMs: 0, endMs: 300, timestampMs: 0, confidence: 1 },
        { text: 'second', startMs: 8200, endMs: 8500, timestampMs: 8200, confidence: 1 },
      ],
    },
    slots: [0, 4000, 8000, 12000].map((start, i) =>
      imageSlot(start, `boom-busters/stills/${i}.png`),
    ),
    overlays: [],
  })
}

const CHAPTERS = [
  { index: 0, contentMd: 'The auditors could not find the money.' },
  { index: 1, contentMd: 'The shares fell ninety percent in nine days.' },
]

describe('planLibrary', () => {
  it('numbers every master slot from 0 with the slot itself as its snapshot', () => {
    const m = master()
    const { entries, slots } = planLibrary(m, { chapters: CHAPTERS })

    expect(entries.map((e) => e.ref)).toEqual([0, 1, 2, 3])
    expect(slots).toEqual(m.slots)
    expect(entries[0]).toMatchObject({
      type: 'still',
      payloadKind: 'image',
      chapterIndex: 0,
      covered: 'The auditors could not find the money.',
    })
    expect(entries[2]).toMatchObject({ chapterIndex: 1 })
  })

  it('gives the same refs for the same master, call after call', () => {
    const first = planLibrary(master(), { chapters: CHAPTERS })
    const second = planLibrary(master(), { chapters: CHAPTERS })
    expect(second).toEqual(first)
  })

  it('falls back to the spoken words when the script has no such paragraph', () => {
    const { entries } = planLibrary(master(), { chapters: [] })
    expect(entries[0]!.covered).toBe('First')
  })
})

describe('the voice and its key', () => {
  it('keys a paragraph by project, Short, version, position and text hash', () => {
    expect(pointParagraphIdempotencyKey('P', 'S', 3, 2, 'some words here')).toBe(
      `point:P:S:3:2:${teaserTextHash('some words here')}`,
    )
  })

  it('refuses a voice whose text is not the script', () => {
    const script = mockPointScript({
      title: 'T',
      sourceChapters: [0],
      bridgeChapters: [1],
    } as TalkingPoint)
    const voice: PointVoiceRecord = {
      scriptVersion: 1,
      paragraphs: script.paragraphs.map((p) => ({
        textHash: teaserTextHash(p.text),
        r2Key: 'mock://x.wav',
        durationMs: 6000,
        wordTimings: null,
      })),
    }
    expect(pointParagraphAudio(script, voice)).toHaveLength(5)
    const edited = {
      ...script,
      paragraphs: script.paragraphs.map((p, i) =>
        i === 1 ? { ...p, text: `${p.text} extra` } : p,
      ),
    }
    expect(() => pointParagraphAudio(edited, voice)).toThrow(ValidationError)
  })
})

function builtInputs() {
  const m = master()
  const script = mockPointScript({
    title: 'The missing money',
    sourceChapters: [0],
    bridgeChapters: [1],
  } as TalkingPoint)
  const voice: PointVoiceRecord = {
    scriptVersion: 1,
    paragraphs: script.paragraphs.map((p) => ({
      textHash: teaserTextHash(p.text),
      r2Key: 'mock://x.wav',
      durationMs: 10_000,
      wordTimings: null,
    })),
  }
  const words = layoutPointNarration(pointParagraphAudio(script, voice)).words.map((w, index) => ({
    index,
    text: w.text,
    startMs: w.startMs,
  }))
  const library = planLibrary(m, { chapters: CHAPTERS })
  const plan: PointPlanRecord = {
    shots: mockPointPlan(words, library.entries).map((shot) => ({
      startWord: shot.startWord,
      crop: shot.crop,
      motion: shot.motion,
      slot: shot.source.kind === 'library' ? library.slots[shot.source.ref]! : null,
      pending: shot.source.kind === 'still' ? { kind: 'still', prompt: shot.source.prompt } : null,
    })),
    plannedFor: { scriptVersion: 1, voiceHash: pointVoiceHash(voice) },
  }
  return { master: m, script, voice, plan }
}

const BRIDGE = { label: 'Full video', channelName: 'Boom & Busters', handle: '@boombusters' }

const stillCandidate = (id: string): SlotCandidate => ({
  id,
  provider: 'google',
  kind: 'image',
  sourceUrl: `generated://google/${id}`,
  r2Key: `boom-busters/stills/${id}.png`,
  licence: 'Generated',
})

describe('fetchPendingShots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
  })

  it('turns a pending still into a slot and pools its candidates', async () => {
    visualAssets.generateStillCandidates.mockResolvedValue([
      stillCandidate('a'),
      stillCandidate('b'),
    ])
    const { plan } = builtInputs()
    const pendingCount = plan.shots.filter((s) => s.pending).length
    expect(pendingCount).toBeGreaterThan(0)

    const result = await fetchPendingShots('P', plan)

    expect(result.ok).toBe(true)
    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(result.plan.shots.every((s) => s.slot !== null && s.pending === null)).toBe(true)
    expect(result.fetched).toBe(pendingCount)
    expect(result.fetches.candidates.length).toBe(pendingCount * 2)
    expect(result.repairs).toEqual([])
    // New stills are asked for as the Short's own kind, framed 9:16 in the opening words.
    const [brief, , stored, kind] = visualAssets.generateStillCandidates.mock.calls[0]!
    expect(kind).toBe('short')
    expect(stored).toBeNull()
    expect(brief.prompt).toMatch(/^Vertical/)
  })

  it('drops a shot whose fetch failed so the shot before runs on, and says so', async () => {
    visualAssets.generateStillCandidates.mockRejectedValue(
      new ValidationError('the model refused it'),
    )
    const { plan } = builtInputs()
    const pendingAt = plan.shots.findIndex((s) => s.pending)

    const result = await fetchPendingShots('P', plan)

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(result.plan.shots).toHaveLength(plan.shots.length - 1)
    expect(result.plan.shots.every((s) => s.slot !== null)).toBe(true)
    expect(result.plan.shots[0]!.startWord).toBe(0)
    expect(result.fetched).toBe(0)
    expect(result.repairs).toEqual([
      {
        action: 'dropped',
        field: `shot ${pendingAt + 1}`,
        reason: expect.stringContaining('the model refused it'),
      },
    ])
  })

  it('hands the first word to the next shot when the first shot fails', async () => {
    visualAssets.generateStillCandidates.mockRejectedValue(new ValidationError('no'))
    const { plan } = builtInputs()
    const first = plan.shots[0]!
    const lead: PointPlanRecord = {
      ...plan,
      shots: [
        { ...first, slot: null, pending: { kind: 'still', prompt: 'Vertical 9:16 a thing' } },
        ...plan.shots.slice(1),
      ],
    }

    const result = await fetchPendingShots('P', lead)

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(result.plan.shots[0]!.startWord).toBe(0)
    expect(result.plan.shots[0]!.slot).not.toBeNull()
  })

  it('stops with a gate when the budget refuses a fetch', async () => {
    const { BudgetExceededError } = await import('@boom-busters/schemas')
    visualAssets.generateStillCandidates.mockRejectedValue(
      new BudgetExceededError({
        provider: 'google',
        operation: 'image',
        budgetUsd: 1,
        monthSpendUsd: 1,
        estimateUsd: 0.14,
      }),
    )
    const { plan } = builtInputs()

    const result = await fetchPendingShots('P', plan)

    expect(result).toMatchObject({ ok: false, gate: { gate: 'budget' } })
  })

  it('runs each fetch through the caller’s step wrapper', async () => {
    visualAssets.generateStillCandidates.mockResolvedValue([stillCandidate('a')])
    const { plan } = builtInputs()
    const names: string[] = []

    await fetchPendingShots('P', plan, async (name, fn) => {
      names.push(name)
      return fn()
    })

    expect(names).toEqual([`fetch-new-${plan.shots.findIndex((s) => s.pending)}`])
  })
})

/** The live branch: keys are checked, a stock result is ingested, nothing is mocked away. */
describe('fetchPendingShots, live stock path', () => {
  const stock = (id: string): SlotCandidate => ({
    id,
    provider: 'pexels',
    kind: 'image',
    sourceUrl: `https://images.example/${id}.jpg`,
    licence: 'Pexels',
  })

  /** The built plan with its one pending still turned into a stock search. */
  function stockPlan(): PointPlanRecord {
    const { plan } = builtInputs()
    return {
      ...plan,
      shots: plan.shots.map((shot) =>
        shot.pending
          ? { ...shot, pending: { kind: 'stock' as const, query: 'audit office' } }
          : shot,
      ),
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '')
  })

  it('searches, ingests the first result and keeps its bytes as the shot', async () => {
    visualAssets.fetchStockCandidates.mockResolvedValue([stock('a'), stock('b')])
    ingest.ingestCandidateBytes.mockImplementation(async (candidate: SlotCandidate) => ({
      ok: true,
      candidate: { ...candidate, r2Key: `boom-busters/stock/${candidate.id}.jpg` },
    }))

    const result = await fetchPendingShots('P', stockPlan())

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(visualAssets.requireVisualKeys).toHaveBeenCalledWith(new Set(['stock']))
    expect(visualAssets.fetchStockCandidates.mock.calls[0]![0]).toMatchObject({
      type: 'stock',
      query: 'audit office',
    })
    expect(ingest.ingestCandidateBytes).toHaveBeenCalledTimes(1)
    expect(ingest.ingestCandidateBytes.mock.calls[0]![0].id).toBe('a')
    const placed = result.plan.shots.find(
      (shot) =>
        shot.slot?.payload.kind === 'image' &&
        shot.slot.payload.src.r2Key === 'boom-busters/stock/a.jpg',
    )
    expect(placed).toBeDefined()
    expect(result.fetched).toBe(1)
    expect(result.fetches.candidates.map((c) => c.id)).toEqual(['a', 'b'])
    expect(result.fetches.candidates[0]!.r2Key).toBe('boom-busters/stock/a.jpg')
  })

  it('drops the shot, with the reason, when the bytes cannot be ingested', async () => {
    visualAssets.fetchStockCandidates.mockResolvedValue([stock('a')])
    ingest.ingestCandidateBytes.mockResolvedValue({ ok: false, reason: 'the download was refused' })
    const plan = stockPlan()

    const result = await fetchPendingShots('P', plan)

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(result.plan.shots).toHaveLength(plan.shots.length - 1)
    expect(result.fetched).toBe(0)
    expect(result.repairs).toEqual([
      expect.objectContaining({
        action: 'dropped',
        reason: expect.stringContaining('the download was refused'),
      }),
    ])
  })

  it('drops the shot when no stock key is stored', async () => {
    visualAssets.requireVisualKeys.mockRejectedValue(
      new ValidationError('no Pexels or Pixabay key'),
    )

    const result = await fetchPendingShots('P', stockPlan())

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(visualAssets.fetchStockCandidates).not.toHaveBeenCalled()
    expect(result.repairs[0]).toMatchObject({ action: 'dropped' })
  })

  it('drops the shot when the search finds nothing', async () => {
    visualAssets.fetchStockCandidates.mockResolvedValue([])

    const result = await fetchPendingShots('P', stockPlan())

    if (!result.ok || !('plan' in result)) throw new Error('expected a plan')
    expect(ingest.ingestCandidateBytes).not.toHaveBeenCalled()
    expect(result.repairs[0]).toMatchObject({ action: 'dropped' })
  })
})

describe('assemblePointShort', () => {
  it('compiles a master that parses, with five phases of narration and both bridge overlays', () => {
    const { master: m, script, voice, plan } = builtInputs()
    const resolved: PointPlanRecord = {
      ...plan,
      shots: plan.shots.map((shot) => ({
        ...shot,
        slot: shot.slot ?? imageSlot(0, 'boom-busters/stills/new.png'),
        pending: null,
      })),
    }

    const { timeline, findings } = assemblePointShort({
      master: m,
      script,
      voice,
      plan: resolved,
      bridge: BRIDGE,
      newImageCount: 1,
    })

    expect(TimelineSchema.safeParse(timeline).success).toBe(true)
    expect(timeline.narration).toHaveLength(5)
    expect(timeline.overlays.map((o) => o.kind).sort()).toEqual(['relatedArrow', 'subscribeBadge'])
    expect(Array.isArray(findings)).toBe(true)
  })

  it('refuses a plan that still waits for a picture', () => {
    const { master: m, script, voice, plan } = builtInputs()
    expect(() =>
      assemblePointShort({ master: m, script, voice, plan, bridge: BRIDGE, newImageCount: 0 }),
    ).toThrow(/still waits/)
  })
})

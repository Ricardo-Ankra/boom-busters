// @vitest-environment node

import {
  channelForProject,
  FIXTURE_PROJECT_ID,
  insertTalkingPointSet,
  requireTestDatabase,
  runs,
  ensureRun,
  seed,
  talkingPointSets,
} from '@boom-busters/db'
import { estimateRenderCostUsd } from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  emptyTalkingPointsModel,
  pointShortEstimateUsd,
  talkingPointCards,
  talkingPointsModel,
} from './talking-points-review'

/**
 * The Talking points model: cards with chapter titles and type words, the
 * history, the per-point estimate arithmetic (design 5.2, price helpers
 * mocked so the sum is checkable by hand) and the busy flag.
 */

const stillSlotEstimateUsd = vi.hoisted(() => vi.fn())
vi.mock('@/lib/visual-assets', () => ({
  stillSlotEstimateUsd: (...args: unknown[]) => stillSlotEstimateUsd(...args),
}))

const estimateTtsUsd = vi.hoisted(() => vi.fn())
const estimateLlmUsd = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/cost', async (original) => ({
  ...(await original()),
  estimateTtsUsd: (...args: unknown[]) => estimateTtsUsd(...args),
  estimateLlmUsd: (...args: unknown[]) => estimateLlmUsd(...args),
}))

const point = (n: number, over: Partial<TalkingPoint> = {}): TalkingPoint => ({
  id: `01HQ0000000000000000000P0${n}`,
  type: 'forensic-breakdown',
  title: `Point ${n} title`,
  question: `What did the auditors miss in year ${n}?`,
  payoff: 'They never tested the cash balances at all.',
  bridge: 'The long film walks through how that unravelled.',
  bridgeChapters: [1],
  sourceChapters: [0],
  hook: 'Nobody checked the one number that mattered.',
  order: n,
  ...over,
})

describe('talkingPointCards', () => {
  const chapters = [
    { index: 0, title: 'The missing number' },
    { index: 1, title: 'The refusal' },
  ]

  it('orders by `order`, words the type and names chapters by title', () => {
    const cards = talkingPointCards(
      [
        point(2, { type: 'result-first', order: 2, sourceChapters: [1], bridgeChapters: [0, 1] }),
        point(1, { type: 'incomplete-mechanism', order: 1 }),
      ],
      chapters,
    )
    expect(cards.map((card) => card.order)).toEqual([1, 2])
    expect(cards.map((card) => card.typeLabel)).toEqual(['Incomplete mechanism', 'Result first'])
    expect(cards[0]!.sourceChapters).toEqual([{ index: 0, title: 'The missing number' }])
    expect(cards[1]!.bridgeChapters.map((chapter) => chapter.title)).toEqual([
      'The missing number',
      'The refusal',
    ])
  })

  it.each([
    ['forensic-breakdown', 'Forensic breakdown'],
    ['contrarian-thesis', 'Contrarian thesis'],
    ['incomplete-mechanism', 'Incomplete mechanism'],
    ['result-first', 'Result first'],
  ] as const)('words %s as "%s"', (type, label) => {
    expect(talkingPointCards([point(1, { type })], chapters)[0]!.typeLabel).toBe(label)
  })

  it('names a chapter the script no longer has by its number', () => {
    const cards = talkingPointCards([point(1, { sourceChapters: [7] })], chapters)
    expect(cards[0]!.sourceChapters[0]!.title).toBe('Chapter 8')
  })
})

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('talkingPointsModel', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    stillSlotEstimateUsd.mockResolvedValue(0.14)
    estimateTtsUsd.mockReturnValue(0.1)
    estimateLlmUsd.mockImplementation(
      ({ inputTokens, outputTokens }: { inputTokens: number; outputTokens: number }) =>
        (inputTokens + outputTokens) / 1_000_000,
    )
    await seed(db)
    await db.delete(talkingPointSets)
    await db.delete(runs)
  })

  it('prices a point from four stills, 960 characters, two calls and a 55 second short render', async () => {
    const perShort = await pointShortEstimateUsd(db, (await channelId()) as string)

    const calls = (12_000 + 1_500) / 1_000_000 + (8_000 + 3_000) / 1_000_000
    expect(perShort).toBeCloseTo(4 * 0.14 + 0.1 + calls + estimateRenderCostUsd(55, 'short'), 10)
    expect(estimateTtsUsd).toHaveBeenCalledWith(expect.objectContaining({ characters: 960 }))
    expect(estimateLlmUsd).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 12_000, outputTokens: 1_500 }),
    )
    expect(estimateLlmUsd).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 8_000, outputTokens: 3_000 }),
    )
  })

  it('is empty before any proposal exists', async () => {
    expect(await talkingPointsModel(db, FIXTURE_PROJECT_ID)).toEqual(emptyTalkingPointsModel())
  })

  it('reads the latest version, the history newest first, and multiplies the estimate by the points', async () => {
    await insertTalkingPointSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      scriptVersion: 1,
      points: [point(1), point(2), point(3)],
      note: null,
    })
    await insertTalkingPointSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      scriptVersion: 1,
      points: [point(1), point(2), point(3), point(4)],
      note: 'one more',
    })

    const model = await talkingPointsModel(db, FIXTURE_PROJECT_ID)
    const perShort = await pointShortEstimateUsd(db, (await channelId()) as string)

    expect(model.version).toBe(2)
    expect(model.points).toHaveLength(4)
    expect(model.history.map((entry) => [entry.version, entry.note])).toEqual([
      [2, 'one more'],
      [1, null],
    ])
    expect(model.estimateUsd).toBeCloseTo(4 * perShort, 10)
    expect(model.busy).toBe(false)
  })

  it('is busy while a talking-points-runner run is live, and not for another function', async () => {
    await insertTalkingPointSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      scriptVersion: 1,
      points: [point(1), point(2), point(3)],
      note: null,
    })
    await ensureRun(db, {
      inngestRunId: '01JTPMODEL0001',
      functionName: 'visuals-runner',
      projectId: FIXTURE_PROJECT_ID,
    })
    expect((await talkingPointsModel(db, FIXTURE_PROJECT_ID)).busy).toBe(false)

    await ensureRun(db, {
      inngestRunId: '01JTPMODEL0002',
      functionName: 'talking-points-runner',
      projectId: FIXTURE_PROJECT_ID,
    })
    expect((await talkingPointsModel(db, FIXTURE_PROJECT_ID)).busy).toBe(true)
  })
})

async function channelId(): Promise<string> {
  return (await channelForProject(db, FIXTURE_PROJECT_ID)).channelId
}

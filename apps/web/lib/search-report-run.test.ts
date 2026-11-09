// @vitest-environment node

import { MODEL_DEFER_MAX, RANK_DEFER_MAX } from '@boom-busters/schemas'
import type { Checkpoint, SearchBrief, SearchReport } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueCheckpoints, runSearchReport } from './search-report-run'

/**
 * The checkpoint report with the database, the model and VidIQ stubbed. The
 * analytics read is the deterministic mock (token mode 'mock'), so the terms
 * are the same every run; the model path is exercised with MOCK_PROVIDERS off.
 */

const h = vi.hoisted(() => {
  class CapReached extends Error {}
  return {
    CapReached,
    row: {
      id: 'row-1',
      state: 'pending' as 'pending' | 'frozen',
      modelAttempts: 0,
      rankAttempts: 0,
      report: null as unknown,
    },
    pendingReport: vi.fn(),
    recordReportDeferral: vi.fn(),
    freezeSearchReport: vi.fn(),
    frozenReportsForChannel: vi.fn(),
    rankChecksForVideo: vi.fn(),
    addRankCheck: vi.fn(),
    getProject: vi.fn(),
    currentBible: vi.fn(),
    rankFor: vi.fn(),
    callLlm: vi.fn(),
  }
})

vi.mock('@boom-busters/db', () => ({
  pendingReport: h.pendingReport,
  recordReportDeferral: h.recordReportDeferral,
  freezeSearchReport: h.freezeSearchReport,
  frozenReportsForChannel: h.frozenReportsForChannel,
  rankChecksForVideo: h.rankChecksForVideo,
  addRankCheck: h.addRankCheck,
  getProject: h.getProject,
  currentBible: h.currentBible,
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/llm', () => ({ callLlm: h.callLlm }))
vi.mock('@/lib/case-evidence', () => ({ rankFor: h.rankFor, CapReached: h.CapReached }))

const CHANNEL = 'channel-1'
const PROJECT = 'project-1'
const VIDEO = 'video-1'
const PUBLISHED = '2026-10-01T15:00:00.000Z'

const keyword = (word: string, extra: Record<string, unknown> = {}) => ({
  keyword: word,
  volume: null,
  competition: null,
  overall: null,
  estimatedMonthlySearch: null,
  growthPct: null,
  ...extra,
})

function brief(overrides: Partial<SearchBrief> = {}): SearchBrief {
  return {
    targetKeyword: keyword('alpha'),
    secondaryKeywords: [],
    searchedQuestions: [],
    angleOptions: [],
    recommendedAngle: null,
    language: 'en',
    ...overrides,
  } as unknown as SearchBrief
}

function input(checkpoint: Checkpoint = 7) {
  return {
    channelId: CHANNEL,
    projectId: PROJECT,
    videoId: VIDEO,
    checkpoint,
    publishedAt: PUBLISHED,
    durationSec: 900,
    token: { mode: 'mock' as const },
  }
}

/** A frozen report of another video, only the fields the baselines read. */
function frozen(videoId: string, durationSec: number, holdSec: number, drop = 0.2, subs = 4) {
  return {
    videoId,
    projectId: `p-${videoId}`,
    report: {
      durationSec,
      earlyDrop: drop,
      engagement: { subscribersPer1k: subs, likesPer1k: null, commentsPer1k: null },
      buckets: {
        target: { views: 10, holdSec },
        researched: { views: 0, holdSec: null },
        unresearched: { views: 0, holdSec: null },
        unmatched: { views: 0, holdSec: null },
      },
    } as unknown as SearchReport,
  }
}

function frozenReport(): SearchReport {
  expect(h.freezeSearchReport).toHaveBeenCalledTimes(1)
  return h.freezeSearchReport.mock.calls[0]![2] as SearchReport
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MOCK_PROVIDERS', '0')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-05T06:00:00Z'))
  Object.assign(h.row, {
    state: 'pending',
    modelAttempts: 0,
    rankAttempts: 0,
    report: null,
  })
  h.pendingReport.mockImplementation(() => Promise.resolve({ ...h.row }))
  h.recordReportDeferral.mockResolvedValue(undefined)
  h.freezeSearchReport.mockResolvedValue(undefined)
  h.frozenReportsForChannel.mockResolvedValue([])
  h.rankChecksForVideo.mockResolvedValue([])
  h.addRankCheck.mockImplementation((_db: unknown, row: { keyword: string }) =>
    Promise.resolve({ ...row, checkedAt: new Date() }),
  )
  h.getProject.mockResolvedValue({ searchBrief: brief() })
  h.currentBible.mockResolvedValue({ bible: { language: 'pt-BR' } })
  h.rankFor.mockResolvedValue(4)
  h.callLlm.mockResolvedValue({ text: '{"terms": []}' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('dueCheckpoints', () => {
  it('waits three days past each checkpoint', () => {
    const published = new Date('2026-10-01T15:00:00Z')
    const none = new Set<Checkpoint>()
    expect(dueCheckpoints(published, new Date('2026-10-10T23:00:00Z'), none)).toEqual([])
    expect(dueCheckpoints(published, new Date('2026-10-11T06:00:00Z'), none)).toEqual([7])
    expect(dueCheckpoints(published, new Date('2026-11-01T06:00:00Z'), none)).toEqual([7, 28])
    expect(dueCheckpoints(published, new Date('2026-11-01T06:00:00Z'), new Set([7]))).toEqual([28])
    expect(dueCheckpoints(published, new Date('2027-01-05T06:00:00Z'), none)).toEqual([7, 28, 90])
  })
})

describe('runSearchReport', () => {
  it('freezes no-research without a model call', async () => {
    h.getProject.mockResolvedValue({ searchBrief: null })

    const result = await runSearchReport(input())

    expect(result.state).toBe('frozen')
    expect(h.callLlm).not.toHaveBeenCalled()
    expect(h.rankFor).not.toHaveBeenCalled()
    const report = frozenReport()
    expect(report.matching).toBe('none')
    expect(report.targetKeyword).toBeNull()
    expect(report.outcome).toBe('no-research')
    // Every term is still listed, as unmatched.
    expect(report.terms.length).toBeGreaterThan(0)
    expect(report.terms.every((t) => t.bucket === 'unmatched')).toBe(true)
    expect(report.range).toEqual({ start: '2026-10-01', end: '2026-10-08' })
  })

  it('matches deterministically first and asks the model only for the rest', async () => {
    // The mock terms are "<word> <seed>"; make one of them contain the target's words.
    const { mockVideoAnalytics } = await import('./youtube-analytics')
    const terms = mockVideoAnalytics(VIDEO).searchTerms.map((t) => t.term)
    const [first, ...rest] = terms as [string, ...string[]]
    h.getProject.mockResolvedValue({
      searchBrief: brief({ targetKeyword: keyword(first) as never }),
    })
    h.callLlm.mockResolvedValue({
      text: JSON.stringify({
        terms: [
          { term: rest[0], bucket: 'unresearched', reason: 'other topic' },
          { term: rest[1], bucket: 'target', keyword: first, reason: 'same want' },
        ],
      }),
    })

    const result = await runSearchReport(input())

    expect(result.state).toBe('frozen')
    expect(h.callLlm).toHaveBeenCalledTimes(1)
    const prompt = (h.callLlm.mock.calls[0]![0] as { messages: { content: string }[] }).messages[0]!
      .content
    expect(prompt).not.toContain(JSON.stringify(first) + '\n- ' + JSON.stringify(first))
    // The deterministic hit is not among the terms put to the model.
    expect(prompt.split('Search terms:')[1]).not.toContain(JSON.stringify(first))
    const report = frozenReport()
    const byTerm = new Map(report.terms.map((t) => [t.term, t]))
    expect(byTerm.get(first)?.bucket).toBe('target')
    expect(byTerm.get(rest[1]!)).toMatchObject({
      bucket: 'target',
      keyword: first,
      reason: 'same want',
    })
    expect(byTerm.get(rest[0]!)?.bucket).toBe('unresearched')
    // A term the model left out is unmatched.
    expect(byTerm.get(rest[2]!)?.bucket).toBe('unmatched')
    expect(report.matching).toBe('full')
  })

  it('defers on a model failure, then freezes deterministic-only on the third', async () => {
    h.callLlm.mockRejectedValue(new Error('provider down'))

    h.row.modelAttempts = 0
    expect(await runSearchReport(input())).toEqual({ state: 'deferred' })
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'model')
    expect(h.freezeSearchReport).not.toHaveBeenCalled()

    h.row.modelAttempts = MODEL_DEFER_MAX - 2
    expect(await runSearchReport(input())).toEqual({ state: 'deferred' })

    h.recordReportDeferral.mockClear()
    h.row.modelAttempts = MODEL_DEFER_MAX - 1
    const result = await runSearchReport(input())
    expect(result.state).toBe('frozen')
    expect(h.recordReportDeferral).not.toHaveBeenCalled()
    const report = frozenReport()
    expect(report.matching).toBe('deterministic-only')
    expect(report.terms.every((t) => t.bucket === 'unmatched' || t.bucket === 'target')).toBe(true)
  })

  it('defers on a refused model answer too', async () => {
    h.callLlm.mockResolvedValue({ text: 'I cannot help with that' })
    expect(await runSearchReport(input())).toEqual({ state: 'deferred' })
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'model')
  })

  it('checks rank once at day 28 and not at day 7', async () => {
    h.callLlm.mockResolvedValue({ text: '{"terms": []}' })

    await runSearchReport(input(7))
    expect(h.rankFor).not.toHaveBeenCalled()
    expect(frozenReport().rank).toBeNull()

    h.freezeSearchReport.mockClear()
    await runSearchReport(input(28))
    expect(h.rankFor).toHaveBeenCalledTimes(1)
    expect(h.rankFor).toHaveBeenCalledWith('alpha', VIDEO, CHANNEL)
    expect(h.addRankCheck).toHaveBeenCalledTimes(1)
    expect(frozenReport().rank).toMatchObject({ keyword: 'alpha', position: 4 })
  })

  it('reuses a rank check made since the checkpoint fell due, and buys none', async () => {
    // Day 28 is due on 2026-11-01 (published 10-01, 28 + 3 days).
    h.rankChecksForVideo.mockResolvedValue([
      { keyword: 'Alpha', position: null, checkedAt: new Date('2026-10-30T10:00:00Z') },
      { keyword: 'alpha', position: 2, checkedAt: new Date('2026-11-02T10:00:00Z') },
    ])

    await runSearchReport(input(28))

    expect(h.rankFor).not.toHaveBeenCalled()
    expect(h.addRankCheck).not.toHaveBeenCalled()
    expect(frozenReport().rank).toEqual({
      keyword: 'alpha',
      position: 2,
      checkedAt: '2026-11-02T10:00:00.000Z',
    })
  })

  it('waits for the credit cap up to seven runs, then freezes with rank skipped', async () => {
    h.rankFor.mockRejectedValue(new h.CapReached('cap'))

    h.row.rankAttempts = 0
    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'rank')
    // The model is not asked while the rank is unsettled.
    expect(h.callLlm).not.toHaveBeenCalled()

    h.row.rankAttempts = RANK_DEFER_MAX - 2
    expect((await runSearchReport(input(28))).state).toBe('deferred')

    h.recordReportDeferral.mockClear()
    h.row.rankAttempts = RANK_DEFER_MAX - 1
    const result = await runSearchReport(input(28))
    expect(result.state).toBe('frozen')
    expect(h.recordReportDeferral).not.toHaveBeenCalled()
    const report = frozenReport()
    expect(report.rank).toBeNull()
    expect(report.rankSkipped).toBe('credit cap')
  })

  it('baselines exclude the video itself and split by length band', async () => {
    // This video is 15 minutes: the mid band. Three mid reports and one short.
    h.frozenReportsForChannel.mockResolvedValue([
      frozen(VIDEO, 900, 9999),
      frozen('a', 700, 100, 0.1, 2),
      frozen('b', 800, 200, 0.2, 4),
      frozen('c', 1100, 300, 0.3, 6),
      frozen('d', 300, 5000, 0.9, 50),
    ])
    h.getProject.mockResolvedValue({ searchBrief: null })

    await runSearchReport(input(7))

    expect(h.frozenReportsForChannel).toHaveBeenCalledWith({}, CHANNEL, 7)
    const { baselines } = frozenReport()
    // Band median of the three mid reports, not the short one, not itself.
    expect(baselines.searchHoldSec).toEqual({ value: 200, basis: 'band' })
    expect(baselines.earlyDrop).toEqual({ value: 0.2, basis: 'band' })
    expect(baselines.subscribersPer1k).toEqual({ value: 4, basis: 'band' })
  })

  it('widens to the channel when the band has fewer than three reports', async () => {
    h.frozenReportsForChannel.mockResolvedValue([
      frozen('a', 700, 100),
      frozen('b', 300, 200),
      frozen('c', 1500, 600),
    ])
    h.getProject.mockResolvedValue({ searchBrief: null })

    await runSearchReport(input(7))

    expect(frozenReport().baselines.searchHoldSec).toEqual({ value: 200, basis: 'channel' })
  })

  it('takes the language from the brief, then the bible', async () => {
    h.getProject.mockResolvedValue({ searchBrief: brief({ language: undefined }) })
    await runSearchReport(input(7))
    const prompt = (h.callLlm.mock.calls[0]![0] as { messages: { content: string }[] }).messages[0]!
      .content
    expect(prompt).toContain('The terms are in pt-BR.')
  })

  it('returns a frozen row as it is, without fetching again', async () => {
    h.row.state = 'frozen'
    h.row.report = { outcome: 'hit-and-held' }

    expect(await runSearchReport(input())).toEqual({ state: 'frozen', outcome: 'hit-and-held' })
    expect(h.freezeSearchReport).not.toHaveBeenCalled()
    expect(h.getProject).not.toHaveBeenCalled()
  })
})

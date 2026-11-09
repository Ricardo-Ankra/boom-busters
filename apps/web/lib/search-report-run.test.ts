// @vitest-environment node

import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { DEFAULT_RESEARCH_THRESHOLDS, MODEL_DEFER_MAX, RANK_DEFER_MAX } from '@boom-busters/schemas'
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
    channelResearchThresholds: vi.fn(),
    rankFor: vi.fn(),
    checkVidiqBudget: vi.fn(),
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
  channelResearchThresholds: h.channelResearchThresholds,
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/llm', () => ({ callLlm: h.callLlm }))
vi.mock('@/lib/vidiq-spend', () => ({ checkVidiqBudget: h.checkVidiqBudget }))
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
  h.channelResearchThresholds.mockResolvedValue({ ...DEFAULT_RESEARCH_THRESHOLDS })
  h.rankFor.mockResolvedValue(4)
  h.checkVidiqBudget.mockResolvedValue({ ok: true, balance: 100, capLeft: 100 })
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

  it("freezes with the channel's thresholds and the outcome follows them", async () => {
    h.getProject.mockResolvedValue({ searchBrief: null })
    const tuned = { ...DEFAULT_RESEARCH_THRESHOLDS, tooEarlyViews: 10_000_000 }
    h.channelResearchThresholds.mockResolvedValue(tuned)

    await runSearchReport(input())

    const report = frozenReport()
    expect(h.channelResearchThresholds).toHaveBeenCalledWith(expect.anything(), CHANNEL)
    expect(report.thresholds).toEqual(tuned)
    // The default would read 'no-research' (see the test above); the tuned floor makes it too early.
    expect(report.outcome).toBe('too-early')
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

  it('a tuned share threshold flips found-for-target', async () => {
    // A target that is not the top term, so only the share rule can find it.
    const { mockVideoAnalytics } = await import('./youtube-analytics')
    const terms = mockVideoAnalytics(VIDEO).searchTerms.map((t) => t.term)
    h.getProject.mockResolvedValue({
      searchBrief: brief({ targetKeyword: keyword(terms[2]!) as never }),
    })
    const floors = { listedViewsMin: 1, targetViewsMin: 1 }

    const strict = { ...DEFAULT_RESEARCH_THRESHOLDS, ...floors, targetShareMin: 0.99 }
    h.channelResearchThresholds.mockResolvedValue(strict)
    await runSearchReport(input())
    const missed = frozenReport()
    expect(missed.thresholds).toEqual(strict)
    expect(missed.outcome).toMatch(/^(missed-target|found-another-way)$/)

    h.freezeSearchReport.mockClear()
    const loose = { ...DEFAULT_RESEARCH_THRESHOLDS, ...floors, targetShareMin: 0.01 }
    h.channelResearchThresholds.mockResolvedValue(loose)
    await runSearchReport(input())
    const hit = frozenReport()
    expect(hit.thresholds).toEqual(loose)
    expect(hit.outcome).toMatch(/^hit-/)
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

  it('never carries a manual rank check into the frozen report: it buys its own', async () => {
    // Day 28 is due on 2026-11-01 (published 10-01, 28 + 3 days).
    h.rankChecksForVideo.mockResolvedValue([
      { keyword: 'alpha', position: 2, checkedAt: new Date('2026-11-02T10:00:00Z') },
    ])

    await runSearchReport(input(28))

    expect(h.rankFor).toHaveBeenCalledTimes(1)
    expect(frozenReport().rank).toMatchObject({ keyword: 'alpha', position: 4 })
  })

  it('does not buy a rank for a day-28 report made long after it was due', async () => {
    // Due 2026-11-01; the seven-day window closed on 2026-11-08.
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'))

    expect((await runSearchReport(input(28))).state).toBe('frozen')

    expect(h.rankFor).not.toHaveBeenCalled()
    expect(h.addRankCheck).not.toHaveBeenCalled()
    const report = frozenReport()
    expect(report.rank).toBeNull()
    expect(report.rankSkipped).toBe('too late for a day-28 rank')
  })

  it('waits for the credit cap up to seven runs, then freezes with rank skipped', async () => {
    h.rankFor.mockRejectedValue(new h.CapReached('cap'))

    h.row.rankAttempts = 0
    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'rank')

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

  it('a capped month defers before the model call', async () => {
    h.checkVidiqBudget.mockResolvedValue({ ok: false, error: 'cap' })

    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })

    expect(h.checkVidiqBudget).toHaveBeenCalledWith(VIDIQ_CREDIT_COST.youtubeSearch)
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'rank')
    expect(h.callLlm).not.toHaveBeenCalled()
    expect(h.rankFor).not.toHaveBeenCalled()
  })

  it('a capped month on the last rank attempt freezes without buying a rank', async () => {
    h.checkVidiqBudget.mockResolvedValue({ ok: false, error: 'cap', capped: true })
    h.row.rankAttempts = RANK_DEFER_MAX - 1

    expect((await runSearchReport(input(28))).state).toBe('frozen')

    expect(h.rankFor).not.toHaveBeenCalled()
    expect(frozenReport().rankSkipped).toBe('credit cap')
  })

  it('a budget refusal that is not the cap freezes with rank check failed on the last attempt', async () => {
    h.checkVidiqBudget.mockResolvedValue({ ok: false, error: 'Add a VidIQ key in Settings' })
    h.row.rankAttempts = RANK_DEFER_MAX - 1

    expect((await runSearchReport(input(28))).state).toBe('frozen')

    expect(h.rankFor).not.toHaveBeenCalled()
    expect(frozenReport().rankSkipped).toBe('rank check failed')
  })

  it('a budget check that throws defers on the rank ladder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.checkVidiqBudget.mockRejectedValue(new Error('db down'))

    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })

    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'rank')
    expect(h.callLlm).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(VIDEO))
    warn.mockRestore()
  })

  it('a rank failure after the model answered defers, then freezes with rank check failed on the last attempt', async () => {
    h.rankFor.mockRejectedValue(new Error('vidiq down'))

    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })
    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'rank')
    expect(h.freezeSearchReport).not.toHaveBeenCalled()

    h.row.rankAttempts = RANK_DEFER_MAX - 1
    expect((await runSearchReport(input(28))).state).toBe('frozen')
    expect(frozenReport().rankSkipped).toBe('rank check failed')
  })

  it('buys the rank only after the baselines are read', async () => {
    h.frozenReportsForChannel.mockRejectedValue(new Error('db down'))

    await expect(runSearchReport(input(28))).rejects.toThrow('db down')

    expect(h.rankFor).not.toHaveBeenCalled()
  })

  it('reads the channel thresholds before buying the rank', async () => {
    await runSearchReport(input(28))

    expect(h.channelResearchThresholds).toHaveBeenCalledTimes(1)
    expect(h.rankFor).toHaveBeenCalledTimes(1)
    expect(h.channelResearchThresholds.mock.invocationCallOrder[0]).toBeLessThan(
      h.rankFor.mock.invocationCallOrder[0] as number,
    )
  })

  it('buys no rank when the channel thresholds cannot be read', async () => {
    h.channelResearchThresholds.mockRejectedValue(new Error('db down'))

    await expect(runSearchReport(input(28))).rejects.toThrow('db down')

    expect(h.rankFor).not.toHaveBeenCalled()
  })

  it('a model deferral buys no rank', async () => {
    h.callLlm.mockRejectedValue(new Error('provider down'))

    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })

    expect(h.recordReportDeferral).toHaveBeenCalledWith({}, 'row-1', 'model')
    expect(h.rankFor).not.toHaveBeenCalled()
    expect(h.addRankCheck).not.toHaveBeenCalled()
  })

  it('the rank is bought once, after the model answers', async () => {
    h.callLlm.mockRejectedValueOnce(new Error('provider down'))

    expect(await runSearchReport(input(28))).toEqual({ state: 'deferred' })
    expect(h.rankFor).not.toHaveBeenCalled()

    h.row.modelAttempts = 1
    expect((await runSearchReport(input(28))).state).toBe('frozen')
    expect(h.rankFor).toHaveBeenCalledTimes(1)
    expect(frozenReport().rank).toMatchObject({ keyword: 'alpha', position: 4 })
  })

  it('buys no budget check outside day 28 or after the window', async () => {
    await runSearchReport(input(7))
    expect(h.checkVidiqBudget).not.toHaveBeenCalled()

    h.freezeSearchReport.mockClear()
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'))
    await runSearchReport(input(28))
    expect(h.checkVidiqBudget).not.toHaveBeenCalled()
  })

  it('defers without counting when the bounded analytics fetch fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const analytics = await import('./youtube-analytics')
    const fetcher = vi
      .spyOn(analytics, 'fetchVideoAnalytics')
      .mockRejectedValue(new Error('403 forbidden'))
    try {
      const result = await runSearchReport({
        ...input(7),
        token: { mode: 'live', accessToken: 'ya29.secret' },
      })
      expect(result).toEqual({ state: 'deferred' })
      expect(h.recordReportDeferral).not.toHaveBeenCalled()
      expect(h.freezeSearchReport).not.toHaveBeenCalled()
      const said = String(warn.mock.calls[0]![0])
      expect(said).toContain(VIDEO)
      expect(said).not.toContain('ya29.secret')
    } finally {
      fetcher.mockRestore()
      warn.mockRestore()
    }
  })

  it('keeps a paid rank when recording it fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.addRankCheck.mockRejectedValue(new Error('db down'))
    try {
      const result = await runSearchReport(input(28))
      expect(result.state).toBe('frozen')
      expect(h.rankFor).toHaveBeenCalledTimes(1)
      expect(h.recordReportDeferral).not.toHaveBeenCalled()
      expect(frozenReport().rank).toMatchObject({ keyword: 'alpha', position: 4 })
      expect(frozenReport().rankSkipped).toBeUndefined()
    } finally {
      warn.mockRestore()
    }
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
    expect(baselines.searchHoldSec).toEqual({ value: 200, basis: 'band', count: 3 })
    expect(baselines.earlyDrop).toEqual({ value: 0.2, basis: 'band', count: 3 })
    expect(baselines.subscribersPer1k).toEqual({ value: 4, basis: 'band', count: 3 })
  })

  it('widens to the channel when the band has fewer than three reports', async () => {
    h.frozenReportsForChannel.mockResolvedValue([
      frozen('a', 700, 100),
      frozen('b', 300, 200),
      frozen('c', 1500, 600),
    ])
    h.getProject.mockResolvedValue({ searchBrief: null })

    await runSearchReport(input(7))

    expect(frozenReport().baselines.searchHoldSec).toEqual({
      value: 200,
      basis: 'channel',
      count: 3,
    })
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

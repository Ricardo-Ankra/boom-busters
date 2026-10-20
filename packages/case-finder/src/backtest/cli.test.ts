import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Sources } from '../evidence'
import { dayRange, monthRange, type PageviewsSource } from '../sources/pageviews'
import {
  mockCourtListener,
  mockEdgar,
  mockSecReleases,
  mockWikidata,
  mockWikipedia,
  mockYoutube,
} from '../sources/mock'
import { QuotaExhaustedError } from '../sources/quota'
import { uploadsPlaylistId, type YoutubeSource } from '../sources/youtube'
import type { HitlistEntry, YoutubeVideo } from '../types'
import { parseCliArgs } from './cli-args'
import {
  FIXTURE_PATH,
  runBacktest,
  runHitlist,
  runSubjects,
  type BaselineScorer,
  type CliContext,
  type GitAdapter,
} from './run'
import type { SubjectFixture } from './subjects'

describe('parseCliArgs', () => {
  it('reads a command with the defaults', () => {
    expect(parseCliArgs(['run'])).toEqual({
      command: 'run',
      live: false,
      baseline: null,
      dailyUnits: 10000,
      spentToday: 0,
      lopucki: null,
    })
  })

  it('reads numbers in both flag forms and refuses anything but a whole number', () => {
    const args = parseCliArgs(['subjects', '--daily-units', '5000', '--spent-today=120'])
    expect(args).toMatchObject({ command: 'subjects', dailyUnits: 5000, spentToday: 120 })
    expect(() => parseCliArgs(['run', '--daily-units', 'lots'])).toThrow(/--daily-units/)
    expect(() => parseCliArgs(['run', '--spent-today', '-5'])).toThrow(/--spent-today/)
    expect(() => parseCliArgs(['run', '--daily-units'])).toThrow(/--daily-units/)
  })

  it('refuses an unknown flag, a missing or unknown command and a stray argument', () => {
    expect(() => parseCliArgs(['run', '--frobnicate'])).toThrow(/--frobnicate/)
    expect(() => parseCliArgs([])).toThrow(/command/)
    expect(() => parseCliArgs(['score'])).toThrow(/score/)
    expect(() => parseCliArgs(['run', 'extra'])).toThrow(/extra/)
  })

  it('--baseline without --live is refused', () => {
    const paid = ['--baseline', '--baseline-provider', 'anthropic', '--baseline-model', 'm1']
    expect(() => parseCliArgs(['run', ...paid])).toThrow(/--live/)
    expect(parseCliArgs(['run', '--live', ...paid]).baseline).toEqual({
      provider: 'anthropic',
      model: 'm1',
    })
  })

  it('--baseline needs a known provider and a model, and only on run', () => {
    expect(() => parseCliArgs(['run', '--live', '--baseline', '--baseline-model', 'm'])).toThrow(
      /--baseline-provider/,
    )
    expect(() =>
      parseCliArgs(['run', '--live', '--baseline', '--baseline-provider', 'mistral']),
    ).toThrow(/mistral/)
    expect(() =>
      parseCliArgs(['run', '--live', '--baseline', '--baseline-provider', 'openai']),
    ).toThrow(/--baseline-model/)
    expect(() => parseCliArgs(['run', '--live', '--baseline-model', 'm'])).toThrow(/--baseline/)
    const paid = ['--baseline', '--baseline-provider', 'google', '--baseline-model', 'm']
    expect(() => parseCliArgs(['hitlist', '--live', ...paid])).toThrow(/run/)
  })

  it('reads the LoPucki path and ignores a leading -- from pnpm', () => {
    expect(parseCliArgs(['--', 'hitlist', '--lopucki', 'C:/data/lopucki.csv']).lopucki).toBe(
      'C:/data/lopucki.csv',
    )
  })
})

const NOW = new Date('2026-10-21T09:00:00Z')

const video = (id: string, title: string, publishedAt: string, views: number): YoutubeVideo => ({
  id,
  channelId: 'UCmodern',
  title,
  publishedAt,
  durationSec: 900,
  views,
})

const MODERN_UPLOADS = [
  video('a1', 'The fall of Alpha Corp', '2021-06-01', 9000),
  video('d1', 'Delta mystery', '2021-04-01', 1000),
  video('b1', 'Beta Inc: the rise', '2021-03-01', 3000),
  // Two years from any other upload: no peers, so its outcome cannot be measured.
  video('g1', 'Gamma explained', '2019-01-01', 500),
]

const HITLIST: HitlistEntry[] = [
  {
    qid: 'Q1',
    enTitle: 'Alpha Corp',
    query: 'Alpha Corp',
    sitelinks: { enwiki: 'Alpha Corp' },
    tags: [{ tag: 'lopucki', lane: 'downfall', since: '2019-01-01' }],
    country: null,
    cik: null,
  },
  {
    qid: 'Q2',
    enTitle: 'Beta Inc',
    query: 'Beta Inc',
    sitelinks: { enwiki: 'Beta Inc' },
    tags: [{ tag: 'founder-link', lane: 'success', since: null }],
    country: null,
    cik: null,
  },
  {
    qid: 'Q3',
    enTitle: 'Gamma',
    query: 'Gamma',
    sitelinks: { enwiki: 'Gamma' },
    tags: [{ tag: 'lopucki', lane: 'downfall', since: '2018-01-01' }],
    country: null,
    cik: null,
  },
]

const flatPageviews: PageviewsSource = {
  monthly: async (_p, _t, from, to) =>
    monthRange(from, to).map((month) => ({ month, views: 1000 })),
  daily: async (_p, _t, from, to) => dayRange(from, to).map((date) => ({ date, views: 30 })),
}

function fakeYoutube(overrides: Partial<YoutubeSource> = {}): YoutubeSource {
  return {
    ...mockYoutube,
    channelByHandle: async (handle) => {
      const channelId = handle === '@ModernMBA' ? 'UCmodern' : `UC${handle.slice(1)}`
      return { channelId, uploadsPlaylistId: uploadsPlaylistId(channelId) }
    },
    uploads: async (channelId, playlist, options) =>
      channelId === 'UCmodern'
        ? { channelId, uploads: MODERN_UPLOADS }
        : channelId.startsWith('UCmock')
          ? mockYoutube.uploads(channelId, playlist, options)
          : { channelId, uploads: [] },
    ...overrides,
  }
}

function fakeSources(youtube: YoutubeSource = fakeYoutube()): Sources {
  return {
    pageviews: flatPageviews,
    wikidata: mockWikidata,
    wikipedia: { ...mockWikipedia, redirectsTo: async () => [], revisionBefore: async () => null },
    youtube,
    courtlistener: mockCourtListener,
    edgar: mockEdgar,
    secReleases: mockSecReleases,
  }
}

const cleanGit: GitAdapter = {
  porcelain: async () => '',
  isTracked: async () => true,
  head: async () => 'abc1234',
}

function context(overrides: Partial<CliContext> = {}): CliContext & { lines: string[] } {
  const lines: string[] = []
  return {
    root: mkdtempSync(path.join(tmpdir(), 'backtest-')),
    mock: true,
    sources: fakeSources(),
    git: cleanGit,
    now: NOW,
    log: (line) => lines.push(line),
    quotaNote: () => 'mock run: no YouTube units spent',
    lines,
    ...overrides,
  }
}

/** The state `hitlist` would leave, written by hand so the subjects match. */
function writeHitlist(ctx: CliContext) {
  const dir = path.join(ctx.root, '.cache', 'case-finder', ctx.mock ? 'mock' : '')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'hitlist.json'),
    JSON.stringify({ builtOn: '2026-10-21', entries: HITLIST, unresolvedBySeed: { lopucki: 4 } }),
  )
}

function writeFixture(ctx: CliContext, fixture: SubjectFixture[]) {
  const file = path.join(ctx.root, FIXTURE_PATH)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(fixture))
}

const readJson = (ctx: CliContext, ...parts: string[]) =>
  JSON.parse(readFileSync(path.join(ctx.root, ...parts), 'utf8'))

const reportPath = (ctx: CliContext, suffix = '-mock.md') =>
  path.join(ctx.root, 'docs', 'case-finder', `backtest-2026-10-21${suffix}`)

describe('the back-test commands', () => {
  it('hitlist writes the snapshot with the unresolved counts', async () => {
    const ctx = context({ sources: { ...fakeSources(), wikipedia: mockWikipedia } })
    expect(
      await runHitlist(ctx, { fetchText: async () => 'rank,company\n', loPuckiCsv: null }),
    ).toBe(0)
    const snapshot = readJson(ctx, '.cache', 'case-finder', 'mock', 'hitlist.json')
    expect(snapshot.builtOn).toBe('2026-10-21')
    expect(snapshot.entries.length).toBeGreaterThan(0)
    expect(snapshot.unresolvedBySeed).toEqual({})
    expect(ctx.lines.some((l) => l.includes('downfall'))).toBe(true)
  })

  it('subjects needs the hitlist first', async () => {
    await expect(runSubjects(context())).rejects.toThrow(/run hitlist first/)
  })

  it('subjects writes the uploads, the proposals and a draft fixture for the hand-check', async () => {
    const ctx = context()
    writeHitlist(ctx)
    expect(await runSubjects(ctx)).toBe(0)
    const dir = ['.cache', 'case-finder', 'mock']
    expect(readJson(ctx, ...dir, 'channel-uploads.json')['@ModernMBA'].uploads).toHaveLength(4)
    expect(
      readJson(ctx, ...dir, 'subject-proposals.json').map((p: { videoId: string }) => p.videoId),
    ).toEqual(['a1', 'd1', 'b1', 'g1'])
    expect(readJson(ctx, ...dir, 'backtest-subjects.draft.json')).toEqual([
      { videoId: 'a1', qid: 'Q1', verdict: 'subject' },
      { videoId: 'd1', qid: null, verdict: 'miss-not-on-hitlist', note: 'lane: ?' },
      { videoId: 'b1', qid: 'Q2', verdict: 'subject' },
      { videoId: 'g1', qid: 'Q3', verdict: 'subject' },
    ])
  })

  it('a full mock run writes a MOCK report with the case table, the unusable case left out', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    expect(await runBacktest(ctx, null)).toBe(0)
    const report = readFileSync(reportPath(ctx), 'utf8')
    expect(report.startsWith('# MOCK')).toBe(true)
    expect(report).toContain('| Video | Channel |')
    expect(report).toContain('| a1 | @ModernMBA |')
    expect(report).toContain('| b1 | @ModernMBA |')
    expect(report).not.toContain('| g1 |')
    expect(report).toContain('- g1 (Gamma explained): No settled peer uploads for video g1')
    expect(report).toContain('not decided: baseline not run')
    expect(report).toContain('Unresolved seed names: 4')
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    expect(cases.rows.map((r: { videoId: string }) => r.videoId)).toEqual(['a1', 'b1'])
    expect(cases.rows.map((r: { T: string }) => r.T)).toEqual(['2021-05-31', '2021-02-28'])
    expect(cases.unusable.map((u: { videoId: string }) => u.videoId)).toEqual(['g1'])
    expect(existsSync(reportPath(ctx, '.md'))).toBe(false)
  })

  it('the baseline scores every usable case by its subject, a miss by its note name', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, [
      { videoId: 'a1', qid: 'Q1', verdict: 'subject' },
      {
        videoId: 'd1',
        qid: null,
        verdict: 'miss-not-on-hitlist',
        note: 'lane: success; name: Delta Holdings',
      },
      { videoId: 'b1', qid: 'Q2', verdict: 'subject' },
      { videoId: 'g1', qid: 'Q3', verdict: 'subject' },
    ])
    const score = vi.fn(async (names: string[]) => ({
      scores: new Map(names.map((n, i) => [n, 10 * (i + 1)])),
      costUsd: 0.0123,
    }))
    const baseline: BaselineScorer = { model: 'test-model', score }
    expect(await runBacktest(ctx, baseline)).toBe(0)
    expect(score).toHaveBeenCalledWith(['Alpha Corp', 'Delta Holdings', 'Beta Inc'])
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    expect(
      cases.rows.map((r: { status: string; baseline: number }) => [r.status, r.baseline]),
    ).toEqual([
      [expect.not.stringMatching(/^miss$/), 10],
      ['miss', 20],
      [expect.not.stringMatching(/^miss$/), 30],
    ])
    expect(ctx.lines.some((l) => l.includes('test-model') && l.includes('0.0123'))).toBe(true)
    expect(readFileSync(reportPath(ctx), 'utf8')).toContain('model test-model')
  })

  it('run --live refuses when config.ts has uncommitted changes', async () => {
    const porcelain = vi.fn(async (p: string) =>
      p.endsWith('config.ts') ? ' M packages/case-finder/src/config.ts' : '',
    )
    const ctx = context({ mock: false, git: { ...cleanGit, porcelain } })
    expect(await runBacktest(ctx, null)).toBe(1)
    expect(porcelain).toHaveBeenCalledWith('packages/case-finder/src/config.ts')
    expect(ctx.lines.join('\n')).toMatch(/config\.ts has uncommitted changes/)
  })

  it('run --live refuses when the subjects fixture is not committed', async () => {
    const untracked = context({ mock: false, git: { ...cleanGit, isTracked: async () => false } })
    expect(await runBacktest(untracked, null)).toBe(1)
    expect(untracked.lines.join('\n')).toMatch(/backtest-subjects\.json is not committed/)
    const porcelain = async (p: string) => (p === FIXTURE_PATH ? ' M ' + FIXTURE_PATH : '')
    const edited = context({ mock: false, git: { ...cleanGit, porcelain } })
    expect(await runBacktest(edited, null)).toBe(1)
    expect(edited.lines.join('\n')).toMatch(/backtest-subjects\.json has uncommitted changes/)
  })

  it('QuotaExhaustedError stops the run with exit code 2 and says how far it got', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    ctx.sources = fakeSources(
      fakeYoutube({
        search: async () => {
          throw new QuotaExhaustedError('out of units')
        },
      }),
    )
    expect(await runBacktest(ctx, null)).toBe(2)
    expect(ctx.lines.join('\n')).toMatch(/0 of 2 test dates complete, 2 remain/)
    expect(existsSync(reportPath(ctx))).toBe(false)
  })
})

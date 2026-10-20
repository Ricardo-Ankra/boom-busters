import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
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
import { uploadsPlaylistId, type YoutubeSource } from '../sources/youtube'
import type { HitlistEntry, YoutubeVideo } from '../types'
import { FIXTURE_PATH, type BaselineScorer, type CliContext, type GitAdapter } from './run'
import type { SubjectFixture } from './subjects'

/**
 * Shared fakes for the back-test command tests: one channel of four uploads,
 * a three-entry hitlist that names them, flat pageviews, a clean git, and a
 * temp-folder context. Test-only; nothing in src imports it.
 */

export const NOW = new Date('2026-10-21T09:00:00Z')

export const video = (
  id: string,
  title: string,
  publishedAt: string,
  views: number,
): YoutubeVideo => ({
  id,
  channelId: 'UCmodern',
  title,
  publishedAt,
  durationSec: 900,
  views,
})

export const MODERN_UPLOADS = [
  video('a1', 'The fall of Alpha Corp', '2021-06-01', 9000),
  video('d1', 'Delta mystery', '2021-04-01', 1000),
  video('b1', 'Beta Inc: the rise', '2021-03-01', 3000),
  // Two years from any other upload: no peers, so its outcome cannot be measured.
  video('g1', 'Gamma explained', '2019-01-01', 500),
]

export const HITLIST: HitlistEntry[] = [
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

export const flatPageviews: PageviewsSource = {
  monthly: async (_p, _t, from, to) =>
    monthRange(from, to).map((month) => ({ month, views: 1000 })),
  daily: async (_p, _t, from, to) => dayRange(from, to).map((date) => ({ date, views: 30 })),
}

export function fakeYoutube(
  overrides: Partial<YoutubeSource> = {},
  modern: YoutubeVideo[] = MODERN_UPLOADS,
): YoutubeSource {
  return {
    ...mockYoutube,
    channelByHandle: async (handle) => {
      const channelId = handle === '@ModernMBA' ? 'UCmodern' : `UC${handle.slice(1)}`
      return { channelId, uploadsPlaylistId: uploadsPlaylistId(channelId) }
    },
    uploads: async (channelId, playlist, options) =>
      channelId === 'UCmodern'
        ? { channelId, uploads: modern }
        : channelId.startsWith('UCmock')
          ? mockYoutube.uploads(channelId, playlist, options)
          : { channelId, uploads: [] },
    ...overrides,
  }
}

export function fakeSources(youtube: YoutubeSource = fakeYoutube()): Sources {
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

export const cleanGit: GitAdapter = {
  porcelain: async () => '',
  isTracked: async () => true,
  head: async () => 'abc1234',
  blob: async () => 'blob1',
}

export const dirtyConfig = async (p: string) =>
  p.endsWith('config.ts') ? ' M packages/case-finder/src/config.ts' : ''

export function context(overrides: Partial<CliContext> = {}): CliContext & { lines: string[] } {
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
export function writeHitlist(
  ctx: CliContext,
  { configBlob = ctx.mock ? null : 'blob1', entries = HITLIST } = {} as {
    configBlob?: string | null
    entries?: HitlistEntry[]
  },
) {
  const dir = path.join(ctx.root, '.cache', 'case-finder', ctx.mock ? 'mock' : '')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, 'hitlist.json'),
    JSON.stringify({
      builtOn: '2026-10-21',
      configBlob,
      entries,
      unresolvedBySeed: { lopucki: 4 },
    }),
  )
}

export const CHECKED: SubjectFixture[] = [
  { videoId: 'a1', qid: 'Q1', verdict: 'subject' },
  {
    videoId: 'd1',
    qid: null,
    verdict: 'miss-not-on-hitlist',
    note: 'lane: success; name: Delta Holdings',
  },
  { videoId: 'b1', qid: 'Q2', verdict: 'subject' },
  { videoId: 'g1', qid: 'Q3', verdict: 'subject' },
]

/** A baseline whose reply is `text`, or JSON scoring each asked name 10, 20, 30... */
export function fakeBaseline(text?: (names: string[]) => string) {
  const ask = vi.fn(async (names: string[]) => ({
    text:
      text?.(names) ??
      JSON.stringify({ scores: names.map((title, i) => ({ title, priorityScore: 10 * (i + 1) })) }),
    costUsd: 0.0123,
    answeredBy: 'test/test-model',
  }))
  const baseline: BaselineScorer = { model: 'test-model', ask }
  return { baseline, ask }
}

export function writeFixture(ctx: CliContext, fixture: SubjectFixture[]) {
  const file = path.join(ctx.root, FIXTURE_PATH)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(fixture))
}

export const readJson = (ctx: CliContext, ...parts: string[]) =>
  JSON.parse(readFileSync(path.join(ctx.root, ...parts), 'utf8'))

export const reportPath = (ctx: CliContext, suffix = '-mock.md') =>
  path.join(ctx.root, 'docs', 'case-finder', `backtest-2026-10-21${suffix}`)

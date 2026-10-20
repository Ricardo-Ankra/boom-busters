import { vi } from 'vitest'
import { gatherAt, type Sources } from '../evidence'
import {
  mockCourtListener,
  mockEdgar,
  mockSecReleases,
  mockWikidata,
  mockYoutube,
} from '../sources/mock'
import { dayRange, monthRange, type PageviewsSource } from '../sources/pageviews'
import type { WikipediaSource } from '../sources/wikipedia'
import type { DatedTag, HitlistEntry, YoutubeVideo } from '../types'

/**
 * Shared fakes for the evidence-gathering tests: one hitlist entry builder,
 * flat pageviews, a Wikipedia whose pages stand as given before T's month,
 * and the mock sources for the rest. Test-only; nothing in src imports it.
 */

export const ANCHOR = '2026-10-20'
export const T = '2020-03-15'
export const DOWNFALL: DatedTag = {
  tag: 'wikidata:dissolved-convicted',
  lane: 'downfall',
  since: '2019-01-01',
}
export const silent = () => {}

export function entry(qid: string, overrides: Partial<HitlistEntry> = {}): HitlistEntry {
  const enTitle = overrides.enTitle !== undefined ? overrides.enTitle : `Article ${qid}`
  return {
    qid,
    enTitle,
    query: enTitle,
    sitelinks: enTitle === null ? {} : { enwiki: enTitle },
    tags: [DOWNFALL],
    country: null,
    cik: null,
    ...overrides,
  }
}

/** Flat views per (project, title): 1000 a month (and 1000 a day) unless `levels` names the title. */
export function flatPageviews(levels: Record<string, number> = {}): PageviewsSource {
  const level = (titles: string[]) => titles.reduce((sum, t) => sum + (levels[t] ?? 1000), 0)
  return {
    monthly: vi.fn(async (_project: string, titles: string[], from: string, to: string) =>
      monthRange(from, to).map((month) => ({ month, views: level(titles) })),
    ),
    daily: vi.fn(async (_project: string, titles: string[], from: string, to: string) =>
      dayRange(from, to).map((date) => ({ date, views: level(titles) })),
    ),
  }
}

/** Pages as they stood before T's month: categories, links and external links per title. */
export function fakeWikipedia(
  pages: Record<string, { categories?: string[]; links?: string[]; externalLinks?: string[] }>,
) {
  const titles = Object.keys(pages)
  const source: WikipediaSource = {
    categoryMembers: vi.fn(async () => []),
    listLinks: vi.fn(async () => []),
    redirectsTo: vi.fn(async () => []),
    qidsFor: vi.fn(async () => new Map()),
    revisionBefore: vi.fn(async (title: string, day: string) => {
      const i = titles.indexOf(title)
      if (i < 0) return null
      const timestamp = new Date(Date.parse(`${day}T00:00:00Z`) - 3_600_000)
        .toISOString()
        .replace('.000Z', 'Z')
      return { revid: i + 1, timestamp }
    }),
    parsed: vi.fn(async (revid: number) => {
      const page = pages[titles[revid - 1]!]!
      return {
        categories: page.categories ?? [],
        externalLinks: page.externalLinks ?? [],
        links: page.links ?? [],
      }
    }),
  }
  return source
}

export function sources(overrides: Partial<Sources> = {}): Sources {
  return {
    pageviews: flatPageviews(),
    wikidata: mockWikidata,
    wikipedia: fakeWikipedia({}),
    youtube: mockYoutube,
    courtlistener: mockCourtListener,
    edgar: mockEdgar,
    secReleases: mockSecReleases,
    ...overrides,
  }
}

export const video = (id: string, channelId: string): YoutubeVideo => ({
  id,
  channelId,
  title: `[fake] ${id}`,
  publishedAt: '2019-06-01',
  durationSec: 900,
  views: 1000,
})

export const gather = (
  hitlist: HitlistEntry[],
  s: Sources,
  asOf = T,
  log: (l: string) => void = silent,
) => gatherAt(hitlist, asOf, s, log, { anchorDay: ANCHOR })

export const byQid = (evidence: Awaited<ReturnType<typeof gatherAt>>, qid: string) =>
  evidence.find((e) => e.entry.qid === qid)!

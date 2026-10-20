import { createHash } from 'node:crypto'
import type { z } from 'zod'
import { dayRange, monthRange, type PageviewsSource } from './pageviews'
import type { EntityFacts, WikidataSource } from './wikidata'
import type { WikipediaSource } from './wikipedia'
import type { YoutubeVideo } from '../types'
import { uploadsPlaylistId, type YoutubeSource } from './youtube'

/**
 * Deterministic mock sources for mock-provider mode and tests. Nothing here
 * resembles real data: titles say "Mock", and series are a pure function of
 * the title so a run is repeatable and two titles never share a curve.
 */

/** A stable unsigned integer from a string. */
function hash(text: string): number {
  return createHash('sha1').update(text).digest().readUInt32BE(0)
}

/** Views for one title and period key: a title-specific base with a small period wobble. */
function mockViews(titles: string[], period: string): number {
  return titles.reduce((sum, title) => {
    const base = 200 + (hash(title) % 5000)
    const wobble = hash(`${title}|${period}`) % Math.max(1, Math.floor(base / 4))
    return sum + base + wobble
  }, 0)
}

export const mockPageviews: PageviewsSource = {
  async monthly(project, titles, from, to) {
    return monthRange(from, to).map((month) => ({
      month,
      views: mockViews(
        titles.map((t) => `${project}|${t}`),
        month,
      ),
    }))
  },
  async daily(project, titles, from, to) {
    return dayRange(from, to).map((date) => ({
      date,
      views: Math.floor(
        mockViews(
          titles.map((t) => `${project}|${t}`),
          date,
        ) / 30,
      ),
    }))
  },
}

export const mockWikidata: WikidataSource = {
  /** The mock has no query engine; it answers an empty result set if the schema accepts one. */
  async sparql<T>(_query: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse({ results: { bindings: [] } })
  },
  async facts(qids) {
    const out = new Map<string, EntityFacts>()
    for (const qid of qids) {
      const title = `Mock entity ${qid}`
      out.set(qid, {
        qid,
        enTitle: title,
        sitelinks: { enwiki: title, dewiki: `${title} (de)` },
        country: 'Q30',
        cik: null,
        dissolved: null,
        people: [
          { qid: `${qid}0`, name: `Mock founder of ${qid}`, living: true, convicted: false },
        ],
      })
    }
    return out
  },
}

const MOCK_ARTICLES = 4
const MOCK_SUBCATEGORY_ARTICLES = 2

const mockArticles = (category: string, count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => `Mock article ${offset + i + 1} in ${category}`)

export const mockWikipedia: WikipediaSource = {
  /** Depth 1 adds two more articles from a mock subcategory, numbered after the first four. */
  async categoryMembers(category, depth) {
    return [
      ...mockArticles(category, MOCK_ARTICLES),
      ...(depth === 1
        ? mockArticles(`${category} subcategory`, MOCK_SUBCATEGORY_ARTICLES, MOCK_ARTICLES)
        : []),
    ]
  },
  async listLinks(page) {
    return mockArticles(page, MOCK_ARTICLES)
  },
  async redirectsTo(title) {
    return [`Mock redirect to ${title}`]
  },
  async qidsFor(titles) {
    return new Map(titles.map((title) => [title, `Q${900000 + (hash(title) % 99999)}`]))
  },
  /** Always one second before the day, so the dating logic has a revision to work from. */
  async revisionBefore(title, day) {
    return {
      revid: 1000000 + (hash(`${title}|${day}`) % 8000000),
      timestamp: new Date(Date.parse(`${day}T00:00:00Z`) - 1000)
        .toISOString()
        .replace('.000Z', 'Z'),
    }
  },
  async parsed(revid) {
    return {
      categories: [`Mock category of revision ${revid}`],
      externalLinks: [`https://example.invalid/mock/${revid}`],
    }
  },
}

const MOCK_VIDEOS = 3

const mockVideo = (channelId: string, label: string, n: number): YoutubeVideo => ({
  id: `mock${hash(`${label}|${n}`).toString(36)}`,
  channelId,
  title: `[mock] ${label} video ${n}`,
  publishedAt: `2020-${String((n % 12) + 1).padStart(2, '0')}-15`,
  durationSec: 300 + (hash(`${label}|${n}`) % 1200),
  views: 1000 + (hash(`${label}|${n}|views`) % 900000),
})

export const mockYoutube: YoutubeSource = {
  async search(query) {
    return {
      fetchedAt: '2026-01-01',
      videos: Array.from({ length: MOCK_VIDEOS }, (_, i) =>
        mockVideo(`UCmock${hash(`${query}|${i}`).toString(36)}`, query, i + 1),
      ),
    }
  },
  async channelByHandle(handle) {
    const channelId = `UCmock${hash(handle).toString(36)}`
    return { channelId, uploadsPlaylistId: uploadsPlaylistId(channelId) }
  },
  async uploads(channelId) {
    return {
      channelId,
      uploads: Array.from({ length: MOCK_VIDEOS }, (_, i) =>
        mockVideo(channelId, channelId, i + 1),
      ),
    }
  },
}

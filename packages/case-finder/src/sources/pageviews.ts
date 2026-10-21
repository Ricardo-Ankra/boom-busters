import { z } from 'zod'
import type { DailyViews, IsoDate, MonthlyViews } from '../types'
import { isJson, type PoliteClient } from './http'

/**
 * Wikimedia per-article pageviews. The caller passes a title together with its
 * redirects (a redirect's views are real readers who typed the old name), and
 * the series are summed. Every month or day in the range is present in the
 * result: the API simply omits periods with no data, and a missing period is
 * a zero, not a gap, for the rank statistics downstream.
 */

export interface PageviewsSource {
  /** Summed over titles; one row per month from `from` to `to` inclusive ('YYYY-MM'). */
  monthly(project: string, titles: string[], from: string, to: string): Promise<MonthlyViews[]>
  /** Summed over titles; one row per day from `from` to `to` inclusive. */
  daily(project: string, titles: string[], from: IsoDate, to: IsoDate): Promise<DailyViews[]>
}

const BASE = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article'

const responseSchema = z.object({
  items: z.array(z.object({ timestamp: z.string(), views: z.number() })),
})

/** Spaces to underscores, then percent-encoded so a slash in a title stays in its segment. */
export function encodeTitle(title: string): string {
  return encodeURIComponent(title.replace(/ /g, '_'))
}

/** Every 'YYYY-MM' from `from` to `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number) as [number, number]
  const [ty, tm] = to.split('-').map(Number) as [number, number]
  const out: string[] = []
  for (let i = fy * 12 + (fm - 1); i <= ty * 12 + (tm - 1); i++) {
    out.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
  }
  return out
}

/** Every 'YYYY-MM-DD' from `from` to `to` inclusive. */
export function dayRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')
}

/** Views by timestamp prefix for one title; a 404 means the title had no views in range. */
async function series(
  client: PoliteClient,
  project: string,
  title: string,
  granularity: 'monthly' | 'daily',
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const url = `${BASE}/${project}/all-access/user/${encodeTitle(title)}/${granularity}/${start}/${end}`
  const res = await client.getText(url, { accept: isJson })
  const out = new Map<string, number>()
  if (res.status === 404) return out
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} failed with status ${res.status}`)
  }
  let body: z.infer<typeof responseSchema>
  try {
    body = responseSchema.parse(JSON.parse(res.data))
  } catch {
    throw new Error(`GET ${url} returned an unexpected shape`)
  }
  for (const item of body.items) {
    // 'YYYYMMDDHH': the month is the first six characters, the day the first eight.
    const key = item.timestamp.slice(0, granularity === 'monthly' ? 6 : 8)
    out.set(key, (out.get(key) ?? 0) + item.views)
  }
  return out
}

export function livePageviews(client: PoliteClient): PageviewsSource {
  return {
    async monthly(project, titles, from, to) {
      const start = `${from.replace('-', '')}0100`
      const end = `${to.replace('-', '')}${lastDayOfMonth(to)}00`
      const all = await Promise.all(
        titles.map((t) => series(client, project, t, 'monthly', start, end)),
      )
      return monthRange(from, to).map((month) => ({
        month,
        views: all.reduce((sum, s) => sum + (s.get(month.replace('-', '')) ?? 0), 0),
      }))
    },
    async daily(project, titles, from, to) {
      const start = `${from.replace(/-/g, '')}00`
      const end = `${to.replace(/-/g, '')}00`
      const all = await Promise.all(
        titles.map((t) => series(client, project, t, 'daily', start, end)),
      )
      return dayRange(from, to).map((date) => ({
        date,
        views: all.reduce((sum, s) => sum + (s.get(date.replace(/-/g, '')) ?? 0), 0),
      }))
    },
  }
}

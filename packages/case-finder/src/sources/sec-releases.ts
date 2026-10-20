import { parse } from 'node-html-parser'
import type { IsoDate, PrimaryDocument } from '../types'
import type { PoliteClient } from './http'

/**
 * The SEC's two enforcement indexes (accounting and auditing releases, and
 * litigation releases), read from their HTML listing pages. A release that
 * names a company is a primary document about it. The indexes are cached for
 * a week: they grow by a few rows a week, and a back-test re-run should cost
 * no requests.
 */

export interface SecRelease {
  kind: 'sec-aaer' | 'sec-litigation'
  number: string
  date: IsoDate
  title: string
  url: string
}

export interface SecReleasesSource {
  index(): Promise<SecRelease[]>
}

const ORIGIN = 'https://www.sec.gov'
const INDEXES = [
  {
    kind: 'sec-aaer',
    path: '/enforcement-litigation/accounting-auditing-enforcement-releases',
    number: /AAER-\d+/,
  },
  {
    kind: 'sec-litigation',
    path: '/enforcement-litigation/litigation-releases',
    number: /LR-\d+/,
  },
] as const

/** A runaway guard: the listings are a few hundred pages, never thousands. */
const MAX_PAGES = 2000

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The date as 'YYYY-MM-DD': the <time datetime> if there is one, else text like "Sept. 30, 2026". */
function parseDate(cell: {
  querySelector(s: string): { getAttribute(n: string): string | undefined } | null
  text: string
}): IsoDate | null {
  const attr = cell.querySelector('time')?.getAttribute('datetime')
  if (attr && /^\d{4}-\d{2}-\d{2}/.test(attr)) return attr.slice(0, 10)
  const m = /([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})/.exec(cell.text)
  if (!m) return null
  const month = MONTHS.indexOf((m[1] ?? '').toLowerCase())
  if (month === -1) return null
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
}

/** Rows of one listing page; a row without a date, a link and a release number is skipped. */
function parsePage(html: string, index: (typeof INDEXES)[number]): SecRelease[] {
  const out: SecRelease[] = []
  for (const row of parse(html).querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td')
    const dateCell = cells[0]
    const titleCell = cells[1]
    if (!dateCell || !titleCell) continue
    const date = parseDate(dateCell)
    const link = titleCell.querySelector('a')
    const href = link?.getAttribute('href')
    const number = index.number.exec(titleCell.text)?.[0]
    const title = link?.text.trim()
    if (!date || !href || !number || !title) continue
    out.push({ kind: index.kind, number, date, title, url: new URL(href, ORIGIN).toString() })
  }
  return out
}

export function liveSecReleases(client: PoliteClient): SecReleasesSource {
  return {
    async index() {
      const out: SecRelease[] = []
      for (const index of INDEXES) {
        for (let page = 0; page < MAX_PAGES; page++) {
          const url = `${ORIGIN}${index.path}?page=${page}`
          const res = await client.getText(url, { maxAgeDays: 7 })
          if (res.status < 200 || res.status >= 300) {
            throw new Error(`GET ${url} failed with status ${res.status}`)
          }
          const rows = parsePage(res.data, index)
          if (rows.length === 0) break
          out.push(...rows)
        }
      }
      return out
    },
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Releases dated strictly before `before` whose title contains any name as a whole word. */
export function releasesNaming(
  index: SecRelease[],
  names: string[],
  before: IsoDate,
): PrimaryDocument[] {
  const patterns = names
    .filter((n) => n.trim() !== '')
    .map((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n.trim())}(?![\\p{L}\\p{N}])`, 'iu'))
  return index
    .filter((r) => r.date < before && patterns.some((p) => p.test(r.title)))
    .map((r) => ({
      url: r.url,
      title: `${r.number}: ${r.title}`,
      source: r.kind,
      datedAt: r.date,
    }))
}

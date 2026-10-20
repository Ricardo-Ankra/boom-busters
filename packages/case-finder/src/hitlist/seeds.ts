import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import type { IsoDate } from '../types'

/**
 * The raw seeds of the hitlist: which Wikipedia categories and list pages to
 * read, the LoPucki bankruptcy CSV, and the two Wikidata queries. Nothing here
 * resolves names to QIDs; build.ts does that once for every seed.
 */

export const SCANDAL_CATEGORIES = [
  'Corporate scandals',
  'Pyramid and Ponzi schemes',
  'Accounting scandals',
] as const

export const CHAPTER_11_FIRST_YEAR = 2000
export const CHAPTER_11_LAST_YEAR = 2025

export const chapter11Category = (year: number) =>
  `Companies that filed for Chapter 11 bankruptcy in ${year}`

export const DOWNFALL_CATEGORIES: readonly string[] = [
  ...SCANDAL_CATEGORIES,
  ...Array.from({ length: CHAPTER_11_LAST_YEAR - CHAPTER_11_FIRST_YEAR + 1 }, (_, i) =>
    chapter11Category(CHAPTER_11_FIRST_YEAR + i),
  ),
]

export const DOWNFALL_LISTS: readonly string[] = [
  'List of corporate collapses and scandals',
  'List of Ponzi schemes',
]

/** Parses a CSV into rows, honouring double quotes, doubled quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

/** YYYY-MM-DD, MM/DD/YYYY or M/D/YYYY to an ISO date; null if it is none of those or not a real day. */
function parseDate(text: string): IsoDate | null {
  const t = text.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  const parts = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1], us[2]] : null
  if (parts === null) return null
  const [y, m, d] = parts as [string, string, string]
  const out = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  const parsed = new Date(`${out}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== out ? null : out
}

/** Absent path or file gives [] and a log line; rows missing a name or a parseable date are skipped and counted. */
export function loadLoPucki(
  csvPath: string | null,
  log: (line: string) => void = () => {},
): { name: string; filed: IsoDate }[] {
  if (csvPath === null || !existsSync(csvPath)) {
    log('lopucki: no CSV supplied, seed skipped')
    return []
  }
  const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, ''))
  const nameCol = header?.findIndex((h) => /name/i.test(h)) ?? -1
  const dateCol = header?.findIndex((h) => /date.*fil|fil.*date/i.test(h)) ?? -1
  if (nameCol < 0 || dateCol < 0) {
    log('lopucki: CSV has no name or filing date column, seed skipped')
    return []
  }
  const out: { name: string; filed: IsoDate }[] = []
  let skipped = 0
  for (const row of rows) {
    const name = row[nameCol]?.trim() ?? ''
    const filed = parseDate(row[dateCol] ?? '')
    if (name === '' || filed === null) skipped++
    else out.push({ name, filed })
  }
  if (skipped > 0) log(`lopucki: skipped ${skipped} rows without a name and filing date`)
  return out
}

const BUSINESS = 'wdt:P31/wdt:P279* wd:Q4830453'

/** Businesses dissolved (P576) whose founder or CEO has a conviction (P1399). */
export const DISSOLVED_CONVICTED_QUERY = `SELECT ?item ?dissolved WHERE {
  ?item ${BUSINESS} ; wdt:P576 ?dissolved .
  ?item wdt:P112|wdt:P169 ?person .
  ?person wdt:P1399 ?conviction .
} LIMIT 5000`

/** Businesses with a founder (P112) and an English Wikipedia article. */
export const FOUNDER_QUERY = `SELECT DISTINCT ?item ?title WHERE {
  ?item ${BUSINESS} ; wdt:P112 ?founder .
  ?article schema:about ?item ;
    schema:isPartOf <https://en.wikipedia.org/> ;
    schema:name ?title .
} LIMIT 20000`

const value = z.object({ value: z.string() })
const bindings = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ results: z.object({ bindings: z.array(z.object(shape)) }) })

export const dissolvedSchema = bindings({ item: value, dissolved: value })
export const founderSchema = bindings({ item: value, title: value })

/** The QID at the end of an entity URI; null for anything else. */
export function qidOf(uri: string): string | null {
  const m = /\/(Q\d+)$/.exec(uri)
  return m ? m[1]! : null
}

/** 'YYYY-MM-DD' from a SPARQL dateTime; null for BCE or malformed values. */
export function sparqlDate(text: string): IsoDate | null {
  const m = /^(\d{4}-\d\d-\d\d)T/.exec(text)
  return m ? m[1]! : null
}

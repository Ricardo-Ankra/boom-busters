import { z } from 'zod'
import { EDGAR_8K_DOWNFALL_ITEM, EDGAR_FORMS } from '../config'
import type { IsoDate, Lane, PrimaryDocument } from '../types'
import { isJson, type PoliteClient } from './http'

/**
 * EDGAR filings by CIK, from the submissions API. The forms that count depend
 * on the lane: a company that is thriving files 10-Ks and prospectuses, one in
 * trouble files late-filing notices and non-reliance 8-Ks. Only filings dated
 * before the cut-off are returned, so the count is what was knowable then.
 */

export interface EdgarSource {
  filings(cik: string, lane: Lane, before: IsoDate): Promise<PrimaryDocument[]>
  /**
   * Exhibit 99.1 of the newest `newest` 8-Ks that report any of `items` (press releases and
   * results sit there), newest first. A filing whose folder has no such exhibit is skipped.
   */
  exhibits(
    cik: string,
    options: { items: readonly string[]; newest: number },
  ): Promise<PrimaryDocument[]>
  /** The newest filing of one form, whatever its date; null if the company has none. */
  latestFiling(cik: string, form: string): Promise<PrimaryDocument | null>
}

/** Columnar arrays, as the API returns them under `filings.recent` and in each older file. */
const columnsSchema = z.object({
  accessionNumber: z.array(z.string()),
  filingDate: z.array(z.string()),
  form: z.array(z.string()),
  items: z.array(z.string()),
  primaryDocument: z.array(z.string()),
})

const submissionsSchema = z.object({
  filings: z.object({
    recent: columnsSchema,
    files: z.array(z.object({ name: z.string() })).default([]),
  }),
})

/** A filing folder's listing; `type` is the document type EDGAR assigns each file. */
const folderIndexSchema = z.object({
  directory: z.object({
    item: z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
  }),
})

const BASE = 'https://data.sec.gov/submissions'
const EXHIBIT_99_1 = /ex-?99[._-]?1/i

type Columns = z.infer<typeof columnsSchema>

/** A 404 means the company files nothing with the SEC; null tells the caller so. */
async function fetchJson<T>(client: PoliteClient, url: string, schema: z.ZodType<T>) {
  const res = await client.getText(url, { accept: isJson })
  if (res.status === 404) return null
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`GET ${url} failed with status ${res.status}`)
  }
  try {
    return schema.parse(JSON.parse(res.data))
  } catch {
    throw new Error(`GET ${url} returned an unexpected shape`)
  }
}

interface FilingRow {
  form: string
  filed: IsoDate
  doc: string
  items: string
  /** The filing's folder on www.sec.gov, no trailing slash. */
  folder: string
}

/**
 * Every filing the submissions API lists for a CIK: the recent block, then each older file.
 * null means the company files nothing with the SEC.
 */
async function filingRows(client: PoliteClient, cik: string): Promise<FilingRow[] | null> {
  const padded = cik.padStart(10, '0')
  const main = await fetchJson(client, `${BASE}/CIK${padded}.json`, submissionsSchema)
  if (main === null) return null
  const columns: Columns[] = [main.filings.recent]
  for (const file of main.filings.files) {
    const older = await fetchJson(client, `${BASE}/${file.name}`, columnsSchema)
    if (older !== null) columns.push(older)
  }
  const cikNumber = String(Number(cik))
  const rows: FilingRow[] = []
  for (const c of columns) {
    c.accessionNumber.forEach((accession, i) => {
      const form = c.form[i]
      const filed = c.filingDate[i]
      const doc = c.primaryDocument[i]
      if (form === undefined || filed === undefined || doc === undefined) return
      rows.push({
        form,
        filed,
        doc,
        items: c.items[i] ?? '',
        folder: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accession.replace(/-/g, '')}`,
      })
    })
  }
  return rows
}

const newestFirst = (a: FilingRow, b: FilingRow) => b.filed.localeCompare(a.filed)

export function liveEdgar(client: PoliteClient): EdgarSource {
  return {
    async filings(cik, lane, before) {
      const rows = await filingRows(client, cik)
      if (rows === null) return []
      const forms: readonly string[] = EDGAR_FORMS[lane]
      return rows
        .filter((r) => forms.includes(r.form) && r.filed < before)
        .filter(
          (r) =>
            !(lane === 'downfall' && r.form === '8-K') || r.items.includes(EDGAR_8K_DOWNFALL_ITEM),
        )
        .map((r) => ({
          url: `${r.folder}/${r.doc}`,
          title: `${r.form} filed ${r.filed}`,
          source: 'edgar' as const,
          datedAt: r.filed,
        }))
    },

    async exhibits(cik, options) {
      const rows = await filingRows(client, cik)
      if (rows === null) return []
      const wanted = new Set(options.items)
      // Older submissions files follow the recent block, so the API order is not strictly by date.
      const matching = rows
        .filter((r) => r.form === '8-K' && r.items.split(',').some((i) => wanted.has(i.trim())))
        .sort(newestFirst)
        .slice(0, options.newest)
      const out: PrimaryDocument[] = []
      for (const r of matching) {
        const index = await fetchJson(client, `${r.folder}/index.json`, folderIndexSchema)
        const exhibit = index?.directory.item.find(
          (f) => EXHIBIT_99_1.test(f.name) || f.type === 'EX-99.1',
        )
        if (exhibit === undefined) continue
        out.push({
          url: `${r.folder}/${exhibit.name}`,
          title: `8-K exhibit 99.1 filed ${r.filed}`,
          source: 'edgar',
          datedAt: r.filed,
        })
      }
      return out
    },

    async latestFiling(cik, form) {
      const rows = await filingRows(client, cik)
      const newest = (rows ?? []).filter((r) => r.form === form).sort(newestFirst)[0]
      if (newest === undefined) return null
      return {
        url: `${newest.folder}/${newest.doc}`,
        title: `${newest.form} filed ${newest.filed}`,
        source: 'edgar',
        datedAt: newest.filed,
      }
    },
  }
}

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

const BASE = 'https://data.sec.gov/submissions'

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

export function liveEdgar(client: PoliteClient): EdgarSource {
  return {
    async filings(cik, lane, before) {
      const padded = cik.padStart(10, '0')
      const main = await fetchJson(client, `${BASE}/CIK${padded}.json`, submissionsSchema)
      if (main === null) return []
      const columns: Columns[] = [main.filings.recent]
      for (const file of main.filings.files) {
        const older = await fetchJson(client, `${BASE}/${file.name}`, columnsSchema)
        if (older !== null) columns.push(older)
      }

      const forms: readonly string[] = EDGAR_FORMS[lane]
      const cikNumber = String(Number(cik))
      const out: PrimaryDocument[] = []
      for (const c of columns) {
        c.accessionNumber.forEach((accession, i) => {
          const form = c.form[i]
          const filed = c.filingDate[i]
          const doc = c.primaryDocument[i]
          if (form === undefined || filed === undefined || doc === undefined) return
          if (!forms.includes(form) || filed >= before) return
          if (lane === 'downfall' && form === '8-K') {
            if (!(c.items[i] ?? '').includes(EDGAR_8K_DOWNFALL_ITEM)) return
          }
          out.push({
            url: `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accession.replace(/-/g, '')}/${doc}`,
            title: `${form} filed ${filed}`,
            source: 'edgar',
            datedAt: filed,
          })
        })
      }
      return out
    },
  }
}

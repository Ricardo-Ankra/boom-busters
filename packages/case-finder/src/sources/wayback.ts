import { z } from 'zod'
import type { PoliteClient } from './http'

/**
 * Internet Archive captures of a site, from the CDX index: at most one per
 * year (`collapse=timestamp:4`), successful fetches only. The replay url pins
 * the capture, so what a dossier cites is what the page said at that moment.
 */

export interface WaybackSource {
  /** `from` and `to` are `YYYY` or `YYYYMMDD`, passed straight to CDX. */
  captures(
    url: string,
    options: { from: string; to: string; limit: number },
  ): Promise<{ timestamp: string; url: string }[]>
}

/** CDX answers an empty body, not `[]`, when nothing matches. */
const rowsSchema = z.array(z.array(z.string()))

export function liveWayback(client: PoliteClient): WaybackSource {
  return {
    async captures(url, options) {
      const cdx =
        `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}` +
        `&output=json&filter=statuscode:200&collapse=timestamp:4` +
        `&from=${options.from}&to=${options.to}&limit=${options.limit}`
      const res = await client.getText(cdx)
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`GET ${cdx} failed with status ${res.status}`)
      }
      if (res.data.trim() === '') return []
      const [header, ...rows] = rowsSchema.parse(JSON.parse(res.data))
      const timestampAt = header?.indexOf('timestamp') ?? -1
      const originalAt = header?.indexOf('original') ?? -1
      if (timestampAt === -1 || originalAt === -1) return []
      return rows.flatMap((row) => {
        const timestamp = row[timestampAt]
        const original = row[originalAt]
        if (timestamp === undefined || original === undefined) return []
        return [{ timestamp, url: `https://web.archive.org/web/${timestamp}/${original}` }]
      })
    },
  }
}

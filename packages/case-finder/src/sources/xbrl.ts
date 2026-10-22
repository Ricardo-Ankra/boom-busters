import { isJson, type PoliteClient } from './http'

/**
 * SEC XBRL company facts: every figure a filer has tagged, in one document.
 * The shape is large and varies by filer, so it is handed back as `unknown` for
 * the caller to pick from.
 */

export interface XbrlSource {
  /** null when the company has no facts (a 404) or the body is not JSON. */
  companyFacts(cik: string): Promise<unknown | null>
}

export function liveXbrl(client: PoliteClient): XbrlSource {
  return {
    async companyFacts(cik) {
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`
      // No `accept`: a client that rejects a non-JSON 200 throws, and here that is a null.
      const res = await client.getText(url)
      if (res.status === 404) return null
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`GET ${url} failed with status ${res.status}`)
      }
      return isJson(res.data) ? (JSON.parse(res.data) as unknown) : null
    },
  }
}

import type { PoliteClient } from './http'

/**
 * Daily prices from Stooq's CSV download, which needs no key. A symbol Stooq
 * does not know answers with a plain-text "No data" body, so the CSV header is
 * the test of a usable answer.
 */

export interface StooqSource {
  /** The CSV text (`Date,Open,High,Low,Close,Volume`), or null when Stooq has no such symbol. */
  daily(symbol: string): Promise<string | null>
}

/** Wikidata stock exchange items to the suffix Stooq files that market under. */
const SUFFIX_BY_EXCHANGE: Record<string, string> = {
  Q13677: 'us', // NYSE
  Q82059: 'us', // NASDAQ
  Q152139: 'de', // Frankfurt
  Q2385849: 'de', // XETRA
  Q171240: 'uk', // London
}

export function stooqSymbol(ticker: string, exchangeQid: string | null): string | null {
  const suffix = exchangeQid === null ? undefined : SUFFIX_BY_EXCHANGE[exchangeQid]
  return suffix === undefined ? null : `${ticker.toLowerCase()}.${suffix}`
}

export function liveStooq(client: PoliteClient): StooqSource {
  return {
    async daily(symbol) {
      const res = await client.getText(
        `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`,
      )
      return res.status >= 200 && res.status < 300 && res.data.startsWith('Date,') ? res.data : null
    },
  }
}

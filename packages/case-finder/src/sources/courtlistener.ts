import { z } from 'zod'
import type { IsoDate, PrimaryDocument } from '../types'
import type { PoliteClient } from './http'

/**
 * CourtListener RECAP dockets that name a company, filed before the cut-off.
 * Only the first page (20 results) is read: the count of dockets is a paper
 * trail signal, and the top hits by relevance are enough to say it exists.
 */

export interface CourtListenerSource {
  dockets(name: string, before: IsoDate): Promise<PrimaryDocument[]>
}

const ORIGIN = 'https://www.courtlistener.com'

const responseSchema = z.object({
  results: z.array(
    z.object({
      caseName: z.string(),
      absolute_url: z.string(),
      dateFiled: z.string().nullish(),
    }),
  ),
})

/** The day before an ISO date: `filed_before` is inclusive, `before` is not. */
function dayBefore(day: IsoDate): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

export function liveCourtListener(client: PoliteClient, token: string): CourtListenerSource {
  return {
    async dockets(name, before) {
      const params = new URLSearchParams({
        type: 'r',
        q: `"${name}"`,
        filed_before: dayBefore(before),
      })
      // The token travels in a header, never the URL, so it cannot reach a cache key or a log.
      const { data } = await client.getJson(
        `${ORIGIN}/api/rest/v4/search/?${params}`,
        responseSchema,
        {
          headers: { Authorization: `Token ${token}` },
        },
      )
      return data.results
        .map((r) => ({
          url: `${ORIGIN}${r.absolute_url}`,
          title: r.caseName,
          source: 'courtlistener' as const,
          datedAt: r.dateFiled ? r.dateFiled.slice(0, 10) : null,
        }))
        .filter((d) => d.datedAt === null || d.datedAt < before)
    },
  }
}

import { z } from 'zod'

/**
 * Caption text for a YouTube video, read the way the watch page's own player
 * reads it: the page embeds a `captionTracks` list, and each track's baseUrl
 * serves the timed text. Not an API with a contact policy, so this sits outside
 * PoliteClient. Every miss is a null, because a video without captions is a
 * normal outcome and the dossier simply goes without it.
 */

export interface TranscriptSegment {
  start: number
  text: string
}

export interface TranscriptSource {
  fetch(videoId: string): Promise<TranscriptSegment[] | null>
}

export interface LiveTranscriptsOptions {
  fetchImpl?: typeof fetch
  /** DATA_CONTACT_EMAIL, sent in the User-Agent like every other case-finder source. */
  contact: string
}

const trackSchema = z.object({
  baseUrl: z.string(),
  languageCode: z.string(),
  kind: z.string().optional(),
})

const json3Schema = z.object({
  events: z
    .array(
      z.object({
        tStartMs: z.number().optional(),
        segs: z.array(z.object({ utf8: z.string().optional() })).optional(),
      }),
    )
    .default([]),
})

/**
 * The JSON array that follows `"captionTracks":`. Bracket matching that knows
 * about strings, since a track name can contain a bracket.
 */
function captionTracksJson(page: string): string | null {
  const key = '"captionTracks":'
  const keyAt = page.indexOf(key)
  if (keyAt === -1) return null
  const start = page.indexOf('[', keyAt + key.length)
  if (start === -1) return null
  let depth = 0
  let inString = false
  for (let i = start; i < page.length; i++) {
    const ch = page[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return page.slice(start, i + 1)
  }
  return null
}

export function liveTranscripts(options: LiveTranscriptsOptions): TranscriptSource {
  const fetchImpl = options.fetchImpl ?? fetch
  const headers = { 'User-Agent': `boom-busters-case-finder/1.0 (+${options.contact})` }

  async function transcript(videoId: string): Promise<TranscriptSegment[] | null> {
    const pageRes = await fetchImpl(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      { headers },
    )
    if (!pageRes.ok) return null
    const json = captionTracksJson(await pageRes.text())
    if (json === null) return null
    const tracks = z.array(trackSchema).parse(JSON.parse(json))
    const english = tracks.filter((t) => t.languageCode.startsWith('en'))
    const track = english.find((t) => t.kind !== 'asr') ?? english[0]
    if (track === undefined) return null

    const captionRes = await fetchImpl(`${track.baseUrl}&fmt=json3`, { headers })
    if (!captionRes.ok) return null
    const { events } = json3Schema.parse(JSON.parse(await captionRes.text()))
    const segments: TranscriptSegment[] = []
    for (const event of events) {
      if (event.segs === undefined) continue
      const text = event.segs
        .map((s) => s.utf8 ?? '')
        .join('')
        .trim()
      if (text === '') continue
      segments.push({ start: (event.tStartMs ?? 0) / 1000, text })
    }
    return segments
  }

  return {
    async fetch(videoId) {
      try {
        return await transcript(videoId)
      } catch {
        return null
      }
    },
  }
}

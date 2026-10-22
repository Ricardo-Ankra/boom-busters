import { DOSSIER_QUOTE_MIN_FOLDED } from '@boom-busters/schemas'

export interface Folded {
  folded: string
  /** map[i] is the offset in the original text of folded character i. */
  map: number[]
}

// Quotes are compared on letters and digits only, so curly quotes, dashes,
// line breaks and a model's retyped punctuation never decide a match.
export function foldText(text: string): Folded {
  let folded = ''
  const map: number[] = []
  let pendingSpace = -1
  let i = 0
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      if (pendingSpace >= 0 && folded.length > 0) {
        folded += ' '
        map.push(pendingSpace)
      }
      pendingSpace = -1
      // Lower-casing can change length (e.g. 'İ'); each output unit maps to this character.
      for (const unit of ch.toLowerCase()) {
        for (let k = 0; k < unit.length; k++) map.push(i)
        folded += unit
      }
    } else if (pendingSpace < 0) {
      pendingSpace = i
    }
    i += ch.length
  }
  return { folded, map }
}

export const TRANSCRIPT_MARKER = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g

// Same-length blanking keeps every offset valid for the original text, and
// stops a marker splitting a quote that runs across it.
export function blankTranscriptMarkers(text: string): string {
  return text.replace(TRANSCRIPT_MARKER, (m) => ' '.repeat(m.length))
}

export function quoteFound(text: string, quote: string): { found: boolean; offset: number | null } {
  const haystack = foldText(blankTranscriptMarkers(text))
  const needle = foldText(quote).folded
  if (needle.length < DOSSIER_QUOTE_MIN_FOLDED) return { found: false, offset: null }
  const at = haystack.folded.indexOf(needle)
  if (at < 0) return { found: false, offset: null }
  return { found: true, offset: haystack.map[at] ?? null }
}

export function locatorSeconds(text: string, offset: number): number | null {
  let seconds: number | null = null
  for (const m of text.matchAll(TRANSCRIPT_MARKER)) {
    if (m.index > offset) break
    const [, a, b, c] = m
    seconds =
      c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c)
  }
  return seconds
}

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'])

export function registrableDomain(url: string): string {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    host = url
  }
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
  if (labels.length <= 2) return labels.join('.')
  const last = labels[labels.length - 1]!
  const second = labels[labels.length - 2]!
  const keep = SECOND_LEVEL.has(second) && /^[a-z]{2}$/.test(last) ? 3 : 2
  return labels.slice(-keep).join('.')
}

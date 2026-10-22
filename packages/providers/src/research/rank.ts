import {
  DOSSIER_CORPUS_TOKENS,
  DOSSIER_DOCUMENT_TOKENS,
  DOSSIER_TIER_SHARES,
  type DocumentKind,
} from '@boom-busters/schemas'
import { estimateTokens, truncateAtParagraph } from './tokens'

export interface RankableDocument {
  id: string
  kind: DocumentKind
  tier: 1 | 2 | 3 | 4 | 5
  tokens: number
  publishedAt: string | null
  text: string
}

export interface RankedDocument extends RankableDocument {
  rank: number
  truncated: boolean
}

export interface RankOptions {
  corpusTokens?: number
  documentTokens?: number
  anchorDate?: string | null
}

const TIERS = [1, 2, 3, 4, 5] as const

/**
 * Dates reach us as YYYY-MM-DD, YYYY-MM or YYYY. A coarser date is compared on
 * the first day of its period, so a bare year never outranks a precise date
 * inside it by accident. Anything unparseable counts as undated.
 */
function dateMs(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Decide which gathered documents the model reads. Each tier may spend its
 * share of the corpus budget, and what it leaves unspent rolls to the next
 * tier, so a thin tier does not waste room a later one could use.
 */
export function rankCorpus(
  docs: readonly RankableDocument[],
  options: RankOptions = {},
): { read: RankedDocument[]; unread: RankableDocument[] } {
  const corpusTokens = options.corpusTokens ?? DOSSIER_CORPUS_TOKENS
  const documentTokens = options.documentTokens ?? DOSSIER_DOCUMENT_TOKENS
  const anchor = dateMs(options.anchorDate)

  const cut = docs.map((d) => {
    const { text, truncated } = truncateAtParagraph(d.text, documentTokens)
    // A truncated document's declared size no longer holds; budget the text we keep.
    return { ...d, text, truncated, tokens: truncated ? estimateTokens(text) : d.tokens }
  })

  const read: RankedDocument[] = []
  const unread: RankableDocument[] = []
  let rollOver = 0

  for (const tier of TIERS) {
    let budget = DOSSIER_TIER_SHARES[tier] * corpusTokens + rollOver
    const inTier = cut
      .filter((d) => d.tier === tier)
      .map((d) => ({ d, ms: dateMs(d.publishedAt) }))
      .sort((a, b) => {
        if (a.ms === null || b.ms === null) {
          return a.ms === b.ms ? 0 : a.ms === null ? 1 : -1
        }
        return anchor !== null ? Math.abs(a.ms - anchor) - Math.abs(b.ms - anchor) : b.ms - a.ms
      })

    for (const { d } of inTier) {
      if (d.tokens <= budget) {
        budget -= d.tokens
        read.push({ ...d, rank: read.length + 1 })
      } else {
        const { truncated: _truncated, ...rest } = d
        unread.push(rest)
      }
    }
    rollOver = budget
  }

  return { read, unread }
}

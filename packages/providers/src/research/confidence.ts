import type { ClaimConfidenceName } from '@boom-busters/schemas'
import { foldText, registrableDomain } from './fold'

const WAYBACK = /^https?:\/\/web\.archive\.org\/web\/[^/]+\/(.+)$/i

/**
 * The publisher a support speaks for. A Wayback capture is the original
 * site's page, so it counts as that site: otherwise the live page and its
 * capture would pass for two independent sources.
 */
function publisherOf(url: string): string {
  const original = WAYBACK.exec(url)?.[1]
  if (original === undefined) return registrableDomain(url)
  return registrableDomain(/^https?:\/\//i.test(original) ? original : `http://${original}`)
}

// Confidence is computed from checked quotes, never taken from the model.
// A syndicated story repeats one quote on two hosts; folded-equal quotes
// count once so a wire copy cannot pass for independent corroboration.
export function computeConfidence(
  supports: readonly { url: string; quote: string; found: boolean }[],
): ClaimConfidenceName {
  const hosts = new Set<string>()
  const seenQuotes = new Set<string>()
  for (const s of supports) {
    if (!s.found) continue
    const quote = foldText(s.quote).folded
    if (seenQuotes.has(quote)) continue
    seenQuotes.add(quote)
    hosts.add(publisherOf(s.url))
  }
  if (hosts.size >= 2) return 'sourced'
  return hosts.size === 1 ? 'single_source' : 'unverified'
}

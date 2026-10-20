import { PRIMARY_DOMAIN_SUFFIXES, PRIMARY_HOST_FIRST_LABELS, PRIMARY_HOSTS } from '../config'
import type { PrimaryDocument } from '../types'

/**
 * Whether an external link on a Wikipedia page points at a primary document
 * (court, regulator, legislature, inspector general) rather than press. The
 * host lists are pre-registered in config.ts. Matching is on whole host labels:
 * `gov.example.com` is not a government site and `notsec.gov` is not sec.gov.
 */
export function isPrimaryReference(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  if (host.startsWith('www.')) host = host.slice(4)
  if (PRIMARY_DOMAIN_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix)))
    return true
  if (PRIMARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true
  const first = host.split('.')[0] ?? ''
  return (PRIMARY_HOST_FIRST_LABELS as readonly string[]).includes(first)
}

/** Primary links of a revision as documents, deduplicated, dated to the revision. */
export function referencesAsDocuments(
  externalLinks: string[],
  revisionTimestamp: string,
): PrimaryDocument[] {
  const seen = new Set<string>()
  const out: PrimaryDocument[] = []
  for (const link of externalLinks) {
    if (seen.has(link) || !isPrimaryReference(link)) continue
    seen.add(link)
    const parsed = new URL(link)
    out.push({
      url: link,
      title: `${parsed.host}${parsed.pathname}`,
      source: 'wikipedia-reference',
      datedAt: revisionTimestamp.slice(0, 10),
    })
  }
  return out
}

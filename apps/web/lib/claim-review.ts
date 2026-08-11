import type { ClaimConfidence } from '@boom-busters/db'

/** The two fields every one of these predicates reads, and nothing more. */
export interface ReviewableClaim {
  confidence: ClaimConfidence | string
  quarantined: boolean
}

/**
 * The pure predicates behind the dossier review screen.
 *
 * Extracted so the rule that actually matters — which claims block approval —
 * can be tested without rendering anything, and so the screen, the gate bar
 * and the server action all read the same function rather than three
 * lookalike conditions that drift apart.
 */

/** A claim nobody sourced and nobody excluded. Blocks the gate. */
export function blocksApproval(claim: ReviewableClaim): boolean {
  return claim.confidence === 'unverified' && !claim.quarantined
}

export function blockingCount(claims: readonly ReviewableClaim[]): number {
  return claims.filter(blocksApproval).length
}

/**
 * The reason shown beside a disabled Approve button.
 *
 * `undefined` when nothing blocks — the caller spreads it, so an absent reason
 * never renders as an empty warning.
 */
export function approvalBlockedReason(claims: readonly ReviewableClaim[]): string | undefined {
  const count = blockingCount(claims)
  if (count === 0) return undefined

  return `${count} unsourced claim(s) — verify or quarantine each one`
}

/**
 * The domain of a source URL, for the claims table.
 *
 * A reviewer scanning forty rows needs "this is a court filing" versus "this
 * is somebody's blog"; ninety characters of query string does not tell them
 * that. An unparseable URL is returned as-is rather than hidden, because a
 * malformed source is itself worth seeing.
 */
export function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

import type { BriefFit } from '@boom-busters/schemas'

/**
 * What a brief's channel fit says to the owner, in words: outside the pillars,
 * or a better pillar than the case's own. Null when the fit raises nothing.
 * Text only; nothing is disabled because of it.
 */
export function fitWarning(
  fit: BriefFit | null | undefined,
  casePillarKey: string | null | undefined,
  pillars: readonly { key: string; label: string }[],
): string | null {
  if (!fit) return null
  if (!fit.inScope) return `Outside this channel's pillars: ${fit.reason}`
  if (fit.pillarKey !== null && fit.pillarKey !== casePillarKey) {
    const label = pillars.find((pillar) => pillar.key === fit.pillarKey)?.label ?? fit.pillarKey
    return `Fits ${label} better: ${fit.reason}`
  }
  return null
}

import type { ClaimRow } from '@boom-busters/db'
import type { ScriptClaim } from '@boom-busters/providers'

/**
 * A stored claim as the prompts take it. One mapper for every request that
 * carries the claim list, so no path drops the legal marker or the source type
 * (the regenerate action once sent claims without `legal`).
 */
export function toScriptClaim(
  claim: Pick<ClaimRow, 'id' | 'text' | 'sourceUrl' | 'confidence' | 'sourceType' | 'legalStatus'>,
): ScriptClaim {
  return {
    id: claim.id,
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    confidence: claim.confidence,
    // Which claims a headline card may cite (decision 257).
    sourceType: claim.sourceType,
    // Only an accusation is marked in the claim list (spec 6.4).
    legal: claim.legalStatus,
  }
}

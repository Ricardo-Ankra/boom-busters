import { estimateLlmUsd } from '@boom-busters/cost'
import { RATE_ANGLES_INPUT_TOKENS, RATE_ANGLES_OUTPUT_TOKENS } from '@boom-busters/providers'
import { canonicalModelId } from '@boom-busters/schemas'
import type { Settings, WorkspaceSettings } from '@boom-busters/schemas'

/**
 * What `Rate the angles` says it will cost: one text call on the channel's
 * research route, priced with the workspace's prices. Kept out of `actions.ts`,
 * which is a `'use server'` module and may export only async functions.
 */
export function rateAnglesEstimateUsd(settings: Settings, workspace: WorkspaceSettings): number {
  const route = settings.modelRouting.research
  return estimateLlmUsd({
    provider: route.provider,
    model: canonicalModelId(route.provider, route.model),
    inputTokens: RATE_ANGLES_INPUT_TOKENS,
    outputTokens: RATE_ANGLES_OUTPUT_TOKENS,
    prices: workspace.modelPrices,
  })
}

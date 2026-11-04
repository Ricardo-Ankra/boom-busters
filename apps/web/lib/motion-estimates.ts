import { estimateLlmUsd } from '@boom-busters/cost'
import {
  DRAFT_OUTPUT_TOKENS,
  READING_INPUT_TOKENS,
  READING_OUTPUT_TOKENS,
} from '@boom-busters/providers'
import { canonicalModelId } from '@boom-busters/schemas'
import type { Settings, WorkspaceSettings } from '@boom-busters/schemas'

/**
 * What the Motion tab says a paid call will cost (spec 2026-11-04, sections
 * 7.2 and 8.4), priced on the channel's graphics route with the workspace's
 * prices: a reading is one vision call with fixed token counts, a draft one
 * text call that grows with the readings it is handed.
 */

const DRAFT_INPUT_TOKENS = 3000
const DRAFT_TOKENS_PER_READING = 900

function graphicsEstimate(
  settings: Settings,
  workspace: WorkspaceSettings,
  inputTokens: number,
  outputTokens: number,
): number {
  const route = settings.modelRouting.graphics
  return estimateLlmUsd({
    provider: route.provider,
    model: canonicalModelId(route.provider, route.model),
    inputTokens,
    outputTokens,
    prices: workspace.modelPrices,
  })
}

export function readingEstimateUsd(settings: Settings, workspace: WorkspaceSettings): number {
  return graphicsEstimate(settings, workspace, READING_INPUT_TOKENS, READING_OUTPUT_TOKENS)
}

export function identityDraftEstimateUsd(
  settings: Settings,
  workspace: WorkspaceSettings,
  readings: number,
): number {
  return graphicsEstimate(
    settings,
    workspace,
    DRAFT_INPUT_TOKENS + DRAFT_TOKENS_PER_READING * readings,
    DRAFT_OUTPUT_TOKENS,
  )
}

import { estimateLlmUsd } from '@boom-busters/cost'
import {
  CRITIC_OUTPUT_TOKENS,
  DRAFT_OUTPUT_TOKENS,
  GRAPHIC_ANSWER_TOKENS,
  READING_INPUT_TOKENS,
  READING_OUTPUT_TOKENS,
  STORYBOARD_INPUT_TOKENS,
  STORYBOARD_OUTPUT_TOKENS,
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

/**
 * A derivation's calls (spec 2026-11-04, sections 9.1 and 12.2) with fixed
 * token counts: the storyboard, the build, the fix and the verify on the
 * graphics route; the critic and the pairwise on the critic route.
 */
export const DERIVE_TOKENS = {
  storyboard: { in: STORYBOARD_INPUT_TOKENS, out: STORYBOARD_OUTPUT_TOKENS },
  build: { in: 9000, out: GRAPHIC_ANSWER_TOKENS },
  critic: { in: 14_000, out: CRITIC_OUTPUT_TOKENS },
  pairwise: { in: 5000, out: 200 },
  fix: { in: GRAPHIC_ANSWER_TOKENS, out: GRAPHIC_ANSWER_TOKENS },
  verify: { in: 14_000, out: CRITIC_OUTPUT_TOKENS },
} as const

export interface DerivationEstimateTable {
  /** The storyboard, the build and the verify: paid once per technique. */
  perTechniqueFixed: number
  /** One critic call and one fix: paid per round. */
  perRound: number
  /** The pairwise ask with the order swapped: paid from round two. */
  perPairwise: number
}

function routeEstimate(
  settings: Settings,
  workspace: WorkspaceSettings,
  task: 'graphics' | 'critic',
  tokens: { in: number; out: number },
): number {
  const route = settings.modelRouting[task]
  return estimateLlmUsd({
    provider: route.provider,
    model: canonicalModelId(route.provider, route.model),
    inputTokens: tokens.in,
    outputTokens: tokens.out,
    prices: workspace.modelPrices,
  })
}

export function derivationEstimateTable(
  settings: Settings,
  workspace: WorkspaceSettings,
): DerivationEstimateTable {
  const on = (task: 'graphics' | 'critic', tokens: { in: number; out: number }) =>
    routeEstimate(settings, workspace, task, tokens)
  return {
    perTechniqueFixed:
      on('graphics', DERIVE_TOKENS.storyboard) +
      on('graphics', DERIVE_TOKENS.build) +
      on('graphics', DERIVE_TOKENS.verify),
    perRound: on('critic', DERIVE_TOKENS.critic) + on('graphics', DERIVE_TOKENS.fix),
    perPairwise: on('critic', DERIVE_TOKENS.pairwise),
  }
}

/** The dialogue's figure: pure, so it follows the ticks and the rounds as the owner changes them. */
export function derivationEstimateUsd(
  table: DerivationEstimateTable,
  input: { techniques: number; rounds: number },
): number {
  const perTechnique =
    table.perTechniqueFixed +
    input.rounds * table.perRound +
    Math.max(0, input.rounds - 1) * table.perPairwise
  return input.techniques * perTechnique
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

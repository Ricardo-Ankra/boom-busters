import 'server-only'

import { estimateLlmUsd, withCost } from '@boom-busters/cost'
import { getSettings, llmCredentials, recordRunEvent } from '@boom-busters/db'
import { llmAdapters, route } from '@boom-busters/providers'
import type { Downgrade, LLMTaskRequest, RoutedResult } from '@boom-busters/providers'
import { canonicalModelId } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * The one way this app calls a language model.
 *
 * Three things have to happen around every call and none of them are optional,
 * so they are bound together here rather than left to each caller to remember:
 *
 *  1. **Routing** comes from the settings row, read fresh on every call.
 *  2. **The budget guard** wraps it, so a call that would cross a monthly cap
 *     raises `BudgetExceededError` *before* the provider is contacted, and the
 *     ledger settles on the real token usage afterwards.
 *  3. **Downgrades are recorded** to `run_events`, so a chapter written by the
 *     fallback model can be labelled as such in Script Studio.
 *
 * There is no unguarded escape hatch. A second path to the providers would
 * eventually be the one that spends money outside the cap.
 */

export interface CallOptions {
  /** Attributes the spend to a project on the Costs screen. */
  projectId?: string
  /** Mirrors downgrades onto this run's activity feed. */
  runRowId?: string
  /**
   * Expected output size for the pre-flight estimate. Defaults to `maxTokens`,
   * which is deliberately pessimistic — an estimate that is too low is the one
   * that lets a run walk through a cap it should have parked on.
   */
  estimateOutputTokens?: number
  signal?: AbortSignal
}

/** ~4 characters per token: close enough for an estimate, and always rounded up. */
function promptTokens(request: LLMTaskRequest): number {
  const chars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0)
  return Math.ceil(chars / 4)
}

export async function callLlm(
  request: LLMTaskRequest,
  options: CallOptions = {},
): Promise<RoutedResult> {
  const settings = await getSettings(db)
  const credentials = await llmCredentials(db, env.SECRETS_ENCRYPTION_KEY)
  const choice = settings.modelRouting[request.task]

  const onDowngrade = async (downgrade: Downgrade) => {
    if (!options.runRowId) return
    await recordRunEvent(db, {
      runId: options.runRowId,
      kind: 'model.fallback',
      message:
        `${downgrade.task}: ${downgrade.from.provider}/${downgrade.from.model} → ` +
        `${downgrade.to.provider}/${downgrade.to.model}`,
      data: { ...downgrade },
    })
  }

  return withCost(
    db,
    {
      provider: choice.provider,
      operation: `llm.${request.task}`,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      // Priced against the model settings asked for. A fallback may answer
      // instead, and it is always cheaper than the tier above it, so the
      // reservation can only ever be too generous — never too small.
      estimateUsd: estimateLlmUsd({
        provider: choice.provider,
        model: canonicalModelId(choice.provider, choice.model),
        inputTokens: promptTokens(request),
        outputTokens: options.estimateOutputTokens ?? request.maxTokens,
      }),
      meta: { task: request.task, model: choice.model },
    },
    async () => {
      const result = await route(
        {
          routing: settings.modelRouting,
          fallbackChain: settings.fallbackChain,
          adapters: llmAdapters(),
          credentials,
          onDowngrade,
        },
        request,
        options.signal ? { signal: options.signal } : {},
      )

      // Settle on what the answering model actually charged, which may be a
      // cheaper fallback than the one the estimate was built from.
      return { result, actualUsd: result.costUsd }
    },
    { settings },
  )
}

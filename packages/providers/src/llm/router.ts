import { RateLimitError, ValidationError, isRetriable } from '@boom-busters/schemas'
import type { LlmProvider, LlmTask, ModelRouting } from '@boom-busters/schemas'
import { findModel, nextTierDown, priceOf } from './types'
import type { LLMProvider, LLMResult, LLMTaskRequest } from './types'

/**
 * The model router (build spec section 6).
 *
 * It resolves `task → {provider, model}` from settings **at call time**, so
 * changing the routing matrix in Settings takes effect on the next step
 * without a redeploy or a restart.
 *
 * Its real job is what happens when a provider is having a bad day. On
 * `overloaded`/5xx, and only after retrying the chosen model, it steps one
 * model tier down inside the same provider, and only then crosses to the
 * configured fallback provider. Each move is reported through `onDowngrade` so
 * the caller can write it to `run_events` and the Script Studio can badge the
 * chapter "written with fallback model" — a downgrade that nobody can see
 * afterwards is indistinguishable from getting what you asked for.
 *
 * It does not touch the database (spec section 3: `providers` never imports
 * from `db`). Credentials arrive decrypted, and downgrades leave by callback.
 */

export interface ModelChoice {
  provider: LlmProvider
  model: string
}

export interface Downgrade {
  task: LlmTask
  from: ModelChoice
  to: ModelChoice
  /** `same-provider-tier-down` or `cross-provider`, plus the triggering error. */
  kind: 'same-provider-tier-down' | 'cross-provider'
  reason: string
}

export interface RouterConfig {
  routing: ModelRouting
  /** Settings' cross-provider chain, tried in order after the tier-down. */
  fallbackChain?: readonly LlmProvider[]
  adapters: Partial<Record<LlmProvider, LLMProvider>>
  /** Decrypted keys, by provider. A provider absent here has no working key. */
  credentials: Partial<Record<LlmProvider, string>>
  onDowngrade?: (downgrade: Downgrade) => void | Promise<void>
  /**
   * Attempts against a single model before it is considered unavailable.
   * Section 6 falls back "after retries", not on the first hiccup.
   */
  attemptsPerModel?: number
  /** Injected by tests so retry backoff does not make the suite sleep. */
  sleepImpl?: (ms: number) => Promise<void>
  /** Injected by tests to make jittered backoff deterministic. */
  randomImpl?: () => number
}

export interface RoutedResult extends LLMResult {
  /** Every downgrade taken to get this answer, in the order they happened. */
  downgrades: Downgrade[]
  /** Actual USD, from the answering model's own price row. */
  costUsd: number
  /** What settings asked for, which may not be what answered. */
  requested: ModelChoice
}

const DEFAULT_ATTEMPTS = 3
const BASE_BACKOFF_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Everything that must be true before a single token is spent.
 *
 * Section 6 is explicit that a missing key fails "at pre-flight with a
 * ValidationError pointing at Settings → Connections, never mid-pipeline".
 * The same applies to a model the adapter does not recognise: without a price
 * row the cost guard cannot estimate the call, and a guard that cannot
 * estimate is a guard that passes everything.
 */
export function preflight(config: RouterConfig, task: LlmTask): {
  adapter: LLMProvider
  choice: ModelChoice
} {
  const choice = config.routing[task]
  const adapter = config.adapters[choice.provider]

  if (!adapter) {
    throw new ValidationError(
      `No adapter is built for ${choice.provider}, which Settings → Models routes "${task}" to.`,
      { field: `modelRouting.${task}.provider` },
    )
  }

  const key = config.credentials[choice.provider]
  if (!key) {
    throw new ValidationError(
      `${choice.provider} has no working API key, and Settings → Models routes "${task}" to it. ` +
        'Add the key in Settings → Connections.',
      { field: `connections.${choice.provider}` },
    )
  }

  if (!findModel(adapter, choice.model)) {
    throw new ValidationError(
      `${choice.provider} does not offer "${choice.model}", so its price is unknown and the ` +
        'budget guard cannot estimate this call. Pick a listed model in Settings → Models.',
      { field: `modelRouting.${task}.model` },
    )
  }

  return { adapter, choice }
}

/**
 * The ordered list of models to try: the configured one, then its tier-down
 * within the same provider, then the top model of each usable provider in the
 * cross-provider chain.
 *
 * Built up front rather than discovered mid-failure, so the fallback path is a
 * value that can be asserted on in a test instead of an emergent behaviour.
 */
export function fallbackPath(config: RouterConfig, task: LlmTask): ModelChoice[] {
  const { adapter, choice } = preflight(config, task)
  const path: ModelChoice[] = [choice]

  const down = nextTierDown(adapter, choice.model)
  if (down) path.push({ provider: choice.provider, model: down.id })

  for (const provider of config.fallbackChain ?? []) {
    if (provider === choice.provider) continue
    const other = config.adapters[provider]
    // A chain entry with no adapter or no key is skipped, not fatal: the
    // fallback existing at all is a bonus, and refusing to run because the
    // *backup* is unconfigured would be worse than running on the primary.
    if (!other || !config.credentials[provider]) continue
    const best = [...other.models].sort((a, b) => a.tier - b.tier)[0]
    if (best) path.push({ provider, model: best.id })
  }

  return path
}

function backoffMs(attempt: number, error: unknown, random: () => number): number {
  if (error instanceof RateLimitError && error.retryAfterMs !== undefined) {
    return error.retryAfterMs
  }
  const exponential = BASE_BACKOFF_MS * 2 ** attempt
  return Math.round(exponential * (0.5 + random() * 0.5))
}

export async function route(
  config: RouterConfig,
  request: LLMTaskRequest,
  options: { signal?: AbortSignal } = {},
): Promise<RoutedResult> {
  const path = fallbackPath(config, request.task)
  const requested = path[0]!
  const attempts = config.attemptsPerModel ?? DEFAULT_ATTEMPTS
  const doSleep = config.sleepImpl ?? sleep
  const random = config.randomImpl ?? Math.random
  const downgrades: Downgrade[] = []

  let lastError: unknown

  for (const [index, choice] of path.entries()) {
    if (index > 0) {
      const from = path[index - 1]!
      const downgrade: Downgrade = {
        task: request.task,
        from,
        to: choice,
        kind: from.provider === choice.provider ? 'same-provider-tier-down' : 'cross-provider',
        reason: lastError instanceof Error ? lastError.message : String(lastError),
      }
      downgrades.push(downgrade)
      await config.onDowngrade?.(downgrade)
    }

    const adapter = config.adapters[choice.provider]!
    const apiKey = config.credentials[choice.provider]!

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await adapter.complete(request, {
          apiKey,
          model: choice.model,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        const model = findModel(adapter, choice.model)!
        return { ...result, downgrades, costUsd: priceOf(model, result.usage), requested }
      } catch (error) {
        lastError = error

        // A refusal or a malformed request fails the same way on every model,
        // so walking down the fallback path would spend money to be told no
        // three more times. Only transient trouble is worth another model.
        if (!isRetriable(error)) throw error

        const lastAttemptOnLastModel =
          attempt === attempts - 1 && index === path.length - 1
        if (lastAttemptOnLastModel) throw error

        if (attempt < attempts - 1) {
          await doSleep(backoffMs(attempt, error, random))
        }
      }
    }
  }

  // Unreachable: the loop above either returns or throws. Kept so the function
  // has no implicit undefined return under `noImplicitReturns`.
  throw lastError instanceof Error ? lastError : new Error('router exhausted every model')
}

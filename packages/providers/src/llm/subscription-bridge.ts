import {
  BridgeAnswerPending,
  SubscriptionBridgeUnavailableError,
  TransientProviderError,
  ValidationError,
  type BridgeParkReason,
} from '@boom-busters/schemas'
import {
  BRIDGE_COMPLETE_PATH,
  BRIDGE_HEALTH_PATH,
  BRIDGE_JOB_HOLD_MAX_MS,
  BridgeCompleteResponseSchema,
  BridgeErrorBodySchema,
  BridgePendingResponseSchema,
  signBridgeRequest,
  type BridgeCompleteRequest,
} from './bridge-protocol'
import { mapNetworkError } from './http'
import type { CallOptions, LLMProvider, LLMResult, LLMTaskRequest } from './types'

/**
 * Answer an adapter's calls on the owner's Claude subscription, through the
 * bridge on their PC (decision 469).
 *
 * The deployed app keeps working the way it always has; only where the
 * tokens come from changes. Every `complete()` first asks the bridge whether
 * it is there. If it is, the call goes to the PC, which runs it through the
 * Claude Agent SDK on the owner's plan and returns the same text and usage
 * the API would. If it is not (PC off, asleep, offline, plan limit spent,
 * token refused) the call throws `SubscriptionBridgeUnavailableError`, which
 * every runner treats as a budget stop: the dossier runner parks on the
 * budget gate until the owner presses Resume, the others stop the stage with
 * the reason until it is run again. It never falls back to the API key: the
 * owner chose waiting over paying.
 *
 * `verifyKey` stays on the wrapped adapter, so Settings -> Connections still
 * proves the stored API key, and the model list is the adapter's own.
 */

export interface SubscriptionBridgeConfig {
  url: string
  secret: string
  fetchImpl?: typeof fetch
  now?: () => number
  /** How long the health check may take before the PC counts as off. */
  healthTimeoutMs?: number
  /** How long a good health check is trusted before the next call asks again. */
  healthTrustMs?: number
}

const DEFAULT_HEALTH_TIMEOUT_MS = 5_000
const DEFAULT_HEALTH_TRUST_MS = 30_000

/**
 * Module-level, keyed by URL, so the trust outlives the per-call wrapper the
 * app builds: a warm function instance making twenty calls in a minute asks
 * the PC once, not twenty times.
 */
const trustedUntil = new Map<string, number>()

/** Test seam: forget every remembered health check. */
export function resetBridgeHealthCache(): void {
  trustedUntil.clear()
}

export function withSubscriptionBridge(
  base: LLMProvider,
  config: SubscriptionBridgeConfig,
): LLMProvider {
  const doFetch = config.fetchImpl ?? fetch
  const now = config.now ?? Date.now
  const healthTimeoutMs = config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS
  const healthTrustMs = config.healthTrustMs ?? DEFAULT_HEALTH_TRUST_MS

  const park = (request: LLMTaskRequest, reason: BridgeParkReason, message: string) =>
    new SubscriptionBridgeUnavailableError({
      provider: base.id,
      operation: `llm.${request.task}`,
      reason,
      message,
    })

  async function ensureReachable(request: LLMTaskRequest, signal?: AbortSignal): Promise<void> {
    if ((trustedUntil.get(config.url) ?? 0) > now()) return

    const headers = signBridgeRequest(
      config.secret,
      { method: 'GET', path: BRIDGE_HEALTH_PATH, body: '' },
      now(),
    )
    const timeout = AbortSignal.timeout(healthTimeoutMs)
    let response: Response
    try {
      response = await doFetch(`${config.url}${BRIDGE_HEALTH_PATH}`, {
        method: 'GET',
        headers,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch (cause) {
      if (signal?.aborted) throw cause
      throw park(
        request,
        'offline',
        'Your PC did not answer, so this Claude call is parked. Turn the PC on (or wake it), ' +
          'check the bridge and Tailscale are running, then resume the run.',
      )
    }

    if (response.status === 401) {
      throw park(
        request,
        'auth',
        'The bridge on your PC refused this app’s signature: LLM_BRIDGE_SECRET differs between ' +
          'Vercel and apps/llm-bridge/.env. Make them match, then resume the run.',
      )
    }
    if (!response.ok) {
      throw park(
        request,
        'offline',
        `Your PC's bridge answered ${response.status} instead of ready, so this Claude call is ` +
          'parked. Check the bridge is running, then resume the run.',
      )
    }
    trustedUntil.set(config.url, now() + healthTrustMs)
  }

  return {
    id: base.id,
    models: base.models,

    verifyKey: (apiKey, options) => base.verifyKey(apiKey, options),

    async complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult> {
      await ensureReachable(request, options.signal)

      const call: BridgeCompleteRequest = {
        model: options.model,
        request: {
          task: request.task,
          system: request.system,
          messages: request.messages,
          maxTokens: request.maxTokens,
          ...(request.cacheablePrefixMessages === undefined
            ? {}
            : { cacheablePrefixMessages: request.cacheablePrefixMessages }),
        },
      }
      // A job (decision 472) is keyed on the attempt and the model alone: the
      // same attempt asked again collects its answer. Not on the request: a
      // later step rebuilds it from replayed step data, which Inngest hands
      // back key-sorted, and from rows re-read since, so a hash of it could
      // differ between the step that started the job and the one collecting
      // it, orphaning the job and buying the answer again.
      const job = options.bridgeJob
        ? {
            key: `${options.bridgeJob.scope}@${options.model}`.slice(0, 300),
            holdMs: Math.min(
              BRIDGE_JOB_HOLD_MAX_MS,
              Math.max(0, Math.round(options.bridgeJob.holdMs)),
            ),
          }
        : undefined
      const payload: BridgeCompleteRequest = job ? { ...call, job } : call
      const body = JSON.stringify(payload)
      const headers = signBridgeRequest(
        config.secret,
        { method: 'POST', path: BRIDGE_COMPLETE_PATH, body },
        now(),
      )

      let response: Response
      try {
        response = await doFetch(`${config.url}${BRIDGE_COMPLETE_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body,
          ...(options.signal ? { signal: options.signal } : {}),
        })
      } catch (cause) {
        // The PC was there a moment ago, so this is a blip or the PC just
        // went to sleep. Forget the trust; the router's retry asks again and
        // parks if it really is gone.
        trustedUntil.delete(config.url)
        if (options.signal?.aborted) throw cause
        throw mapNetworkError(`${base.id} (subscription bridge)`, cause)
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        let parsed: ReturnType<typeof BridgeErrorBodySchema.safeParse> | undefined
        try {
          parsed = BridgeErrorBodySchema.safeParse(JSON.parse(text))
        } catch {
          parsed = undefined
        }
        const kind = parsed?.success ? parsed.data.error.kind : undefined
        const message = parsed?.success ? parsed.data.error.message : text.slice(0, 300)

        if (kind === 'plan-limit') {
          throw park(
            request,
            'plan-limit',
            `Your Claude plan's usage limit is spent (${message}). Resume the run once the ` +
              'limit resets.',
          )
        }
        if (kind === 'auth') {
          throw park(
            request,
            'auth',
            `Claude refused the subscription token on your PC (${message}). Run ` +
              '`claude setup-token`, put the new token in apps/llm-bridge/.env, restart the ' +
              'bridge, then resume the run.',
          )
        }
        if (kind === 'unauthorised' || response.status === 401) {
          trustedUntil.delete(config.url)
          throw park(
            request,
            'auth',
            'The bridge on your PC refused this app’s signature: LLM_BRIDGE_SECRET differs ' +
              'between Vercel and apps/llm-bridge/.env. Make them match, then resume the run.',
          )
        }
        if (kind === 'invalid') {
          throw new ValidationError(`${base.id} (subscription bridge): ${message}`)
        }
        // `upstream`, or a bridge too broken to say: worth another attempt.
        throw new TransientProviderError(`${base.id} (subscription bridge)`, message, {
          status: response.status,
        })
      }

      // The job is still running on the PC: not an answer, not a failure.
      if (response.status === 202 && job) {
        BridgePendingResponseSchema.parse(await response.json())
        throw new BridgeAnswerPending(job.key)
      }

      const answer = BridgeCompleteResponseSchema.parse(await response.json())

      // Same rule as the API adapter: a reply that spent its whole budget and
      // wrote nothing is a too-small maxTokens, not a parsing problem.
      if (answer.text.trim() === '' && answer.truncated) {
        throw new ValidationError(
          `${base.id}/${options.model} (subscription) used all ${answer.usage.outputTokens} ` +
            `output tokens without producing any text. maxTokens was ${request.maxTokens} — ` +
            'raise it for this task.',
          { field: 'maxTokens' },
        )
      }

      return {
        text: answer.text,
        usage: answer.usage,
        provider: base.id,
        // What settings asked for, as the API adapter reports it, so the
        // ledger and the price lookups key on the same id either way.
        model: options.model,
        truncated: answer.truncated,
        billing: 'subscription',
      }
    },
  }
}

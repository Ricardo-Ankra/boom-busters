/**
 * The pipeline error taxonomy (build spec section 7).
 *
 * The retry policy in every runner is one line — `isRetriable(error)` — and
 * this file is what makes that line correct. Three properties matter:
 *
 * - **retriable**: Inngest retries it (4 attempts, backoff + jitter).
 * - **gated**: it is not a failure at all. `BudgetExceededError` parks the run
 *   on a budget gate and the UI asks the human to approve the overage or abort
 *   (section 6). Nothing silently dies because a cap was hit.
 * - **spentUsd**: money that left the account before the error. The cost guard
 *   records it instead of releasing the reservation, so a provider that
 *   charged for a failed call still shows up in the ledger.
 *
 * These live in `schemas` rather than `providers` because `cost`, the Inngest
 * runners and the UI all classify errors, and none of them may depend on the
 * provider adapters.
 */

export interface PipelineErrorOptions {
  cause?: unknown
  /** Money already spent when the call failed. Recorded, never released. */
  spentUsd?: number
}

export class PipelineError extends Error {
  /** Whether Inngest should retry. Overridden per subclass, never per instance. */
  readonly retriable: boolean = false
  /** Whether this parks the run on a gate rather than failing it. */
  readonly gated: boolean = false
  readonly spentUsd: number | undefined

  constructor(message: string, options: PipelineErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.spentUsd = options.spentUsd
  }
}

/** A provider was reachable but unhappy — 5xx, overloaded, connection reset. */
export class TransientProviderError extends PipelineError {
  override readonly retriable = true
  readonly provider: string
  readonly status: number | undefined

  constructor(
    provider: string,
    message: string,
    options: PipelineErrorOptions & { status?: number } = {},
  ) {
    super(`${provider}: ${message}`, options)
    this.provider = provider
    this.status = options.status
  }
}

/**
 * Rate limited. `retryAfterMs` comes from the provider's `retry-after` header
 * and the runner honours it rather than using its own backoff (section 7).
 */
export class RateLimitError extends TransientProviderError {
  readonly retryAfterMs: number | undefined

  constructor(
    provider: string,
    message: string,
    options: PipelineErrorOptions & { status?: number; retryAfterMs?: number } = {},
  ) {
    super(provider, message, options)
    this.retryAfterMs = options.retryAfterMs
  }
}

/** Malformed input or output. Retrying sends the same bad payload again. */
export class ValidationError extends PipelineError {
  readonly field: string | undefined

  constructor(message: string, options: PipelineErrorOptions & { field?: string } = {}) {
    super(message, options)
    this.field = options.field
  }
}

/** A provider refused the content. Needs a human, not another attempt. */
export class ContentPolicyError extends PipelineError {
  readonly provider: string

  constructor(provider: string, message: string, options: PipelineErrorOptions = {}) {
    super(`${provider}: ${message}`, options)
    this.provider = provider
  }
}

/**
 * A monthly cap (or the kill switch) would be crossed by this call. Not a
 * failure: the run parks on `waitForEvent('budget/approved')` and the UI shows
 * an "Over budget — approve overage / abort" card (section 6).
 */
export class BudgetExceededError extends PipelineError {
  override readonly gated = true
  readonly provider: string
  readonly operation: string
  readonly budgetUsd: number
  readonly monthSpendUsd: number
  readonly estimateUsd: number
  readonly killSwitch: boolean

  constructor(details: {
    provider: string
    operation: string
    budgetUsd: number
    monthSpendUsd: number
    estimateUsd: number
    killSwitch?: boolean
  }) {
    const killSwitch = details.killSwitch ?? false
    super(
      killSwitch
        ? `Kill switch is on — refused ${details.provider} ${details.operation} (est. $${details.estimateUsd.toFixed(4)}).`
        : `${details.provider} monthly budget would be exceeded: ` +
            `$${details.monthSpendUsd.toFixed(2)} spent + $${details.estimateUsd.toFixed(4)} estimated ` +
            `> $${details.budgetUsd.toFixed(2)} cap.`,
    )
    this.provider = details.provider
    this.operation = details.operation
    this.budgetUsd = details.budgetUsd
    this.monthSpendUsd = details.monthSpendUsd
    this.estimateUsd = details.estimateUsd
    this.killSwitch = killSwitch
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Should Inngest retry this?
 *
 * Unknown errors default to **retriable**. A step that dies on a socket hangup
 * or an undeployed cold start deserves another attempt, and the taxonomy above
 * is the exhaustive list of things we know retrying cannot fix.
 */
export function isRetriable(error: unknown): boolean {
  if (error instanceof PipelineError) return error.retriable
  return true
}

/** Whether the error should park the run on a gate instead of failing it. */
export function isGated(error: unknown): boolean {
  return error instanceof PipelineError && error.gated
}

/** Provider-requested backoff in milliseconds, if the error carries one. */
export function retryAfterMs(error: unknown): number | undefined {
  return error instanceof RateLimitError ? error.retryAfterMs : undefined
}

/** Money that left the account before the error, if any. */
export function spentUsd(error: unknown): number | undefined {
  return error instanceof PipelineError ? error.spentUsd : undefined
}

/**
 * A structured, JSON-safe form for the `runs.error` / `run_events.data`
 * columns and the UI. Deliberately excludes the stack: run rows are read by
 * the activity drawer, and a stack trace there is noise, not information.
 */
export function serialiseError(error: unknown): Record<string, unknown> {
  if (error instanceof BudgetExceededError) {
    return {
      name: error.name,
      message: error.message,
      retriable: false,
      gated: true,
      provider: error.provider,
      operation: error.operation,
      budgetUsd: error.budgetUsd,
      monthSpendUsd: error.monthSpendUsd,
      estimateUsd: error.estimateUsd,
      killSwitch: error.killSwitch,
    }
  }

  if (error instanceof PipelineError) {
    return {
      name: error.name,
      message: error.message,
      retriable: error.retriable,
      gated: error.gated,
      ...(error.spentUsd === undefined ? {} : { spentUsd: error.spentUsd }),
    }
  }

  if (error instanceof Error) {
    return { name: error.name, message: error.message, retriable: true, gated: false }
  }

  return { name: 'UnknownError', message: String(error), retriable: true, gated: false }
}

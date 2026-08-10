/**
 * Fan-out partial-failure policy (build spec section 7).
 *
 * "Collect per-item results; if failures are 15% of items or fewer, succeed
 * and mark the failed items for human resolution at the next gate; if more,
 * fail the step."
 *
 * The threshold exists because the alternative policies are both wrong. Fail
 * on any error and one bad stock photo kills a 200-slot run that a human could
 * fix in ten seconds at the gate. Succeed on any error and a provider outage
 * silently produces a video that is 90% placeholders.
 *
 * Pure, so the rule is testable without an orchestrator.
 */

export const DEFAULT_FAILURE_THRESHOLD = 0.15

export interface FanOutItem<T> {
  key: string
  value?: T
  error?: { name: string; message: string }
}

export interface FanOutVerdict<T> {
  /** True when the step should be treated as successful. */
  ok: boolean
  succeeded: FanOutItem<T>[]
  failed: FanOutItem<T>[]
  failureRatio: number
  /** Human-readable summary for the run event and the gate's warning count. */
  summary: string
}

export function classifyFanOut<T>(
  items: FanOutItem<T>[],
  threshold: number = DEFAULT_FAILURE_THRESHOLD,
): FanOutVerdict<T> {
  const failed = items.filter((item) => item.error !== undefined)
  const succeeded = items.filter((item) => item.error === undefined)

  // An empty fan-out is a success with nothing in it, not a division by zero.
  const failureRatio = items.length === 0 ? 0 : failed.length / items.length
  const ok = failureRatio <= threshold

  const summary =
    failed.length === 0
      ? `${succeeded.length}/${items.length} resolved`
      : `${succeeded.length}/${items.length} resolved, ${failed.length} failed ` +
        `(${(failureRatio * 100).toFixed(0)}%${ok ? ' — within tolerance, flagged for review' : ' — over tolerance'})`

  return { ok, succeeded, failed, failureRatio, summary }
}

/** Turn a settled promise array into fan-out items, keyed in input order. */
export function toFanOutItems<T>(
  keys: readonly string[],
  results: readonly PromiseSettledResult<T>[],
): FanOutItem<T>[] {
  return results.map((result, index) => {
    const key = keys[index] ?? String(index)
    if (result.status === 'fulfilled') return { key, value: result.value }
    const reason: unknown = result.reason
    return {
      key,
      error:
        reason instanceof Error
          ? { name: reason.name, message: reason.message }
          : { name: 'UnknownError', message: String(reason) },
    }
  })
}

import {
  ContentPolicyError,
  RateLimitError,
  TransientProviderError,
  ValidationError,
} from '@boom-busters/schemas'

/**
 * Turning vendor HTTP failures into the shared error taxonomy.
 *
 * This mapping is the whole reason the router can be provider-agnostic: the
 * decision "retry, fall back, gate, or stop" is made once here from a status
 * code, rather than three times in three adapters from three different JSON
 * error shapes.
 *
 * The default for an unrecognised failure is deliberately *not* retriable.
 * Retrying a 4xx we do not understand spends money four times to receive the
 * same complaint, and the taxonomy already routes non-retriable errors to a
 * human (spec section 7).
 */

export interface HttpFailure {
  status: number
  /** The provider's own message, for the run event and the failure card. */
  message: string
  retryAfterMs?: number
  /** True when the vendor's error body identifies a content refusal. */
  refusal?: boolean
}

export function mapHttpFailure(provider: string, failure: HttpFailure): Error {
  const { status, message } = failure

  if (failure.refusal) return new ContentPolicyError(provider, message)

  if (status === 429) {
    /**
     * A 429 that means "you have run out of money" is not a rate limit.
     *
     * Both arrive as 429 `RESOURCE_EXHAUSTED` from Google, and only the body
     * separates them: "Resource has been exhausted" clears in a minute, while
     * "Your prepayment credits are depleted" does not clear until a human tops
     * the account up. Treating the second as transient means four retries with
     * backoff against a wall, then a run that reports itself as a provider
     * outage — sending you to look at a status page instead of a billing page.
     *
     * Found the first time a real Gemini key was pointed at this app: the key
     * was valid, the models were right, and the account had no credits.
     */
    if (BILLING_EXHAUSTED.test(message)) {
      return new ValidationError(
        `${provider} has no credit left, so nothing will run until the account is topped up. ` +
          `The key itself is fine. Provider said: ${message.slice(0, 200)}`,
        { field: `connections.${provider}` },
      )
    }

    return new RateLimitError(provider, message, {
      status,
      ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    })
  }

  // 529 is Anthropic's "overloaded"; 5xx generally means the vendor, not us.
  if (status >= 500) return new TransientProviderError(provider, message, { status })

  if (status === 401 || status === 403) {
    return new ValidationError(
      `${provider} rejected the API key (${status}). Check it in Settings → Connections.`,
      { field: `connections.${provider}` },
    )
  }

  return new ValidationError(`${provider} refused the request (${status}): ${message}`)
}

/** `retry-after` is seconds in the common case, an HTTP date in the rare one. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined

  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs)
}

/**
 * A network-level failure — DNS, reset connection, timeout. Always transient:
 * nothing about the request was wrong, so the same request may well work.
 */
export function mapNetworkError(provider: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new TransientProviderError(provider, `could not be reached (${message})`, { cause })
}

/** Vendor error bodies differ; what counts as "it refused me" does not. */
const REFUSAL = /content.?(policy|filter)|safety|refus|blocked/i

/**
 * A 429 that will not clear on its own.
 *
 * Deliberately narrow: it matches money running out, not capacity running out.
 * "Resource has been exhausted" and "quota exceeded" stay retriable, because
 * those really do clear in a minute — widening this would turn every rate limit
 * into a hard stop.
 */
const BILLING_EXHAUSTED =
  /prepayment|credits? (are |is )?(depleted|exhausted)|billing|insufficient (funds|credit)|payment required/i

/**
 * Read a failed response and throw the mapped error. Shared by every adapter
 * so that one vendor's 429 behaves exactly like another's.
 */
export async function throwForResponse(provider: string, response: Response): Promise<never> {
  const body = await response.text().catch(() => '')
  const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), Date.now())

  throw mapHttpFailure(provider, {
    status: response.status,
    // Bodies can be enormous when a vendor echoes the request back; the first
    // 500 characters is plenty to diagnose from and safe to put in a run event.
    message: body.slice(0, 500),
    refusal: REFUSAL.test(body),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

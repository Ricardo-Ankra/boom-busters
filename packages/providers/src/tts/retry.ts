import { RateLimitError, retryAfterMs } from '@boom-busters/schemas'

/**
 * Waiting out a TTS rate limit instead of failing the paragraph.
 *
 * Narration is the one stage that fans out dozens of paid calls in seconds,
 * and Gemini's preview TTS models carry single-digit requests-per-minute caps
 * plus rolling spend windows — so a full script *will* meet 429s in normal
 * operation. Before this existed, each 429 was swallowed by the runner as a
 * permanent per-paragraph failure, and a Gemini run on a real script died on
 * the 15% fan-out tolerance while behaving exactly as the vendor documents.
 *
 * The policy: retry only `RateLimitError` (everything else is the caller's
 * problem — a refused key does not fix itself by waiting), honour the vendor's
 * `retry-after` when it sends one, fall back to a fixed backoff when it does
 * not, and give up rather than wait absurdly — a vendor asking for an hour is
 * answered by failing the paragraph, which the runner's tolerance and the
 * flagged-for-you path already know how to present.
 *
 * Deliberately a plain in-process wait, not an Inngest sleep: the call sits
 * inside a fan-out step whose siblings are mid-purchase, and throwing to reach
 * a durable sleep would retry the whole batch — re-buying whatever was in
 * flight. A minute of wall-clock inside one step is the cheaper honest option.
 */
export interface PatienceOptions {
  /** Total tries, the first included. */
  attempts?: number
  /** Waits when the vendor sends no retry-after, indexed by retry number. */
  backoffMs?: readonly number[]
  /** The longest single wait honoured; a demand beyond it fails instead. */
  maxWaitMs?: number
  /** Injected by tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_BACKOFF_MS = [5_000, 15_000, 30_000] as const

export async function withRateLimitPatience<T>(
  fn: () => Promise<T>,
  options: PatienceOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const maxWaitMs = options.maxWaitMs ?? 60_000
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (!(error instanceof RateLimitError) || attempt >= attempts) throw error

      const wait = retryAfterMs(error) ?? backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0
      if (wait > maxWaitMs) throw error

      await sleep(wait)
    }
  }
}

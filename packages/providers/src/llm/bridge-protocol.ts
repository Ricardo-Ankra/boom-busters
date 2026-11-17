import { createHmac, timingSafeEqual } from 'node:crypto'
import { LlmTaskSchema } from '@boom-busters/schemas'
import { z } from 'zod'

/**
 * The wire between the deployed app and the subscription bridge on the
 * owner's PC (decision 469).
 *
 * Shared by both ends so they cannot drift: the adapter wrapper in this
 * package signs and sends, `apps/llm-bridge` verifies and answers. The bridge
 * is reachable from the internet through Tailscale Funnel, so every request
 * carries an HMAC over its timestamp, method, path and body; a request
 * without a valid signature, or one older than `MAX_CLOCK_SKEW_MS`, is
 * refused before its body is even parsed.
 */

export const BRIDGE_TIMESTAMP_HEADER = 'x-bridge-timestamp'
export const BRIDGE_SIGNATURE_HEADER = 'x-bridge-signature'

/** How far a request's timestamp may sit from the bridge's clock, either way. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

export const BRIDGE_HEALTH_PATH = '/health'
export const BRIDGE_COMPLETE_PATH = '/complete'

const ImageSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().min(1),
})

const MsgSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  images: z.array(ImageSchema).optional(),
})

/** `LLMTaskRequest` as it crosses the wire. `useBatch` stays behind: the bridge has no batch mode. */
export const BridgeCompleteRequestSchema = z.object({
  model: z.string().min(1),
  request: z.object({
    task: LlmTaskSchema,
    system: z.string(),
    messages: z.array(MsgSchema).min(1),
    maxTokens: z.number().int().positive(),
    cacheablePrefixMessages: z.number().int().nonnegative().optional(),
  }),
})

export type BridgeCompleteRequest = z.infer<typeof BridgeCompleteRequestSchema>

export const BridgeCompleteResponseSchema = z.object({
  text: z.string(),
  usage: z.object({
    inputTokens: z.number().nonnegative(),
    outputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative().optional(),
    cacheWriteInputTokens: z.number().nonnegative().optional(),
  }),
  /** The model that answered, as Claude Code reports it. */
  model: z.string().min(1),
  truncated: z.boolean(),
})

export type BridgeCompleteResponse = z.infer<typeof BridgeCompleteResponseSchema>

/**
 * Why the bridge could not answer.
 *
 * - `plan-limit`: the Claude plan's usage limit is spent. Parks the run.
 * - `auth`: the subscription token was refused or has expired. Parks the run.
 * - `unauthorised`: the request's own signature failed; the two ends hold different secrets. Parks the run.
 * - `invalid`: the request itself is malformed. Not worth retrying.
 * - `upstream`: Anthropic was unhappy (overloaded, 5xx). Worth retrying.
 */
export const BridgeErrorKindSchema = z.enum([
  'plan-limit',
  'auth',
  'unauthorised',
  'invalid',
  'upstream',
])

export type BridgeErrorKind = z.infer<typeof BridgeErrorKindSchema>

export const BridgeErrorBodySchema = z.object({
  error: z.object({
    kind: BridgeErrorKindSchema,
    message: z.string(),
    status: z.number().int().optional(),
  }),
})

export type BridgeErrorBody = z.infer<typeof BridgeErrorBodySchema>

/** The HTTP status the bridge answers each error kind with. */
export const BRIDGE_ERROR_STATUS: Record<BridgeErrorKind, number> = {
  'plan-limit': 429,
  auth: 403,
  unauthorised: 401,
  invalid: 400,
  upstream: 502,
}

interface SignedParts {
  method: string
  path: string
  body: string
  timestamp: string
}

function signature(secret: string, parts: SignedParts): string {
  return createHmac('sha256', secret)
    .update(`${parts.timestamp}.${parts.method.toUpperCase()}.${parts.path}.${parts.body}`)
    .digest('hex')
}

/** The two headers a request to the bridge must carry. */
export function signBridgeRequest(
  secret: string,
  request: { method: string; path: string; body: string },
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = String(now)
  return {
    [BRIDGE_TIMESTAMP_HEADER]: timestamp,
    [BRIDGE_SIGNATURE_HEADER]: signature(secret, { ...request, timestamp }),
  }
}

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'mismatch'

/**
 * Check a request's signature in constant time. The timestamp is checked
 * first, so a replayed request is refused even when its signature is right.
 */
export function verifyBridgeSignature(
  secret: string,
  request: {
    method: string
    path: string
    body: string
    timestamp: string | undefined
    signature: string | undefined
  },
  now: number = Date.now(),
): SignatureCheck {
  const { timestamp, signature: given } = request
  if (!timestamp || !given) return 'missing'
  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_CLOCK_SKEW_MS) return 'stale'

  const expected = Buffer.from(signature(secret, { ...request, timestamp }), 'hex')
  const actual = Buffer.from(given, 'hex')
  if (actual.length !== expected.length) return 'mismatch'
  return timingSafeEqual(actual, expected) ? 'ok' : 'mismatch'
}

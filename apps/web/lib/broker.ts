import {
  CancelAcceptedSchema,
  hasEnvGroup,
  MediaJobSchema,
  RenderAcceptedSchema,
  RenderProgressSchema,
  RenderRequestSchema,
  requireEnv,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type {
  CancelAccepted,
  MediaJob,
  RenderAccepted,
  RenderProgress,
  RenderRequest,
} from '@boom-busters/schemas'

/**
 * The app's client for the render broker (build spec section 8). Bearer
 * token from env; every payload validated against the shared contract
 * before it leaves — the broker validates again on arrival, so a drift
 * fails loudly on whichever side changed.
 */

const MEDIA_PATHS: Record<MediaJob['kind'], string> = {
  qc: '/media/qc',
  loudnorm: '/media/loudnorm',
  transcribe: '/media/transcribe',
  'upload-youtube': '/media/upload-youtube',
}

/** Where the Lambdas call back to — the single broker hook route. */
export function brokerCallbackUrl(): string {
  const base = process.env['AUTH_URL'] ?? 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/api/hooks/broker`
}

/** Whether a broker deployment is configured at all — the mock/live fork. */
export function brokerConfigured(): boolean {
  return hasEnvGroup('broker')
}

function brokerBase(): { url: string; token: string } {
  const { AWS_BROKER_URL, AWS_BROKER_TOKEN } = requireEnv('broker')
  return { url: AWS_BROKER_URL.replace(/\/$/, ''), token: AWS_BROKER_TOKEN }
}

async function brokerFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown> {
  const { url, token } = brokerBase()
  const response = await fetch(`${url}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (!response.ok) {
    const detail = await brokerErrorDetail(response)
    const message =
      `broker answered ${response.status} for ${init.method} ${path}` +
      (detail ? `: ${detail}` : '')
    // A refusal of the request itself (decision 282) does not change between
    // retries: the same timeline goes to the same broker, and four more
    // attempts only hid the reason. A conflict (409, the concurrency cap), a
    // rate limit and a server error are worth another try.
    if (response.status >= 400 && response.status < 500 && ![409, 429].includes(response.status)) {
      throw new NonRetriableError(message)
    }
    throw new Error(message)
  }
  return response.json() as Promise<unknown>
}

/**
 * What the broker said when it refused (decision 282): its `error` and the
 * first few `issues` (for a timeline, the paths that did not validate). The
 * status alone ("422") told nobody which slot was wrong.
 */
async function brokerErrorDetail(response: Response): Promise<string> {
  let text: string
  try {
    text = await response.text()
  } catch {
    return ''
  }
  try {
    const body = JSON.parse(text) as { error?: unknown; issues?: unknown }
    const error = typeof body.error === 'string' ? body.error : ''
    const issues = Array.isArray(body.issues)
      ? body.issues
          .slice(0, 5)
          .map((issue) => String(issue))
          .join('; ')
      : ''
    return [error, issues]
      .filter((part) => part !== '')
      .join(': ')
      .slice(0, 600)
  } catch {
    return text.trim().slice(0, 300)
  }
}

/**
 * Invoke a render (spec section 8: POST /renders). The renders row must
 * exist BEFORE this call — its ULID keys everything on the broker side,
 * and the spend exists the moment the invoke is accepted.
 */
export async function submitRender(request: RenderRequest): Promise<RenderAccepted> {
  const validated = RenderRequestSchema.parse(request)
  return RenderAcceptedSchema.parse(
    await brokerFetch('/renders', { method: 'POST', body: validated }),
  )
}

/** Proxied getRenderProgress — what the UI polls at 2 s (section 8). */
export async function fetchRenderProgress(renderId: string): Promise<RenderProgress> {
  return RenderProgressSchema.parse(await brokerFetch(`/renders/${renderId}`, { method: 'GET' }))
}

/** The section 8.1 cancel: tombstone on the broker, spend already sunk. */
export async function cancelRender(renderId: string): Promise<CancelAccepted> {
  return CancelAcceptedSchema.parse(
    await brokerFetch(`/renders/${renderId}/cancel`, { method: 'POST' }),
  )
}

/** Dispatch a media-utils job; resolves once the broker has accepted it. */
export async function submitMediaJob(job: MediaJob): Promise<void> {
  const { AWS_BROKER_URL, AWS_BROKER_TOKEN } = requireEnv('broker')
  const validated = MediaJobSchema.parse(job)
  const response = await fetch(
    `${AWS_BROKER_URL.replace(/\/$/, '')}${MEDIA_PATHS[validated.kind]}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${AWS_BROKER_TOKEN}`,
      },
      body: JSON.stringify(validated),
    },
  )
  if (response.status !== 202) {
    throw new Error(`broker refused ${validated.kind} job: ${response.status}`)
  }
}

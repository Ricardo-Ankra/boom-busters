import {
  CancelAcceptedSchema,
  hasEnvGroup,
  MediaJobSchema,
  RenderAcceptedSchema,
  RenderProgressSchema,
  RenderRequestSchema,
  requireEnv,
} from '@boom-busters/schemas'
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
    throw new Error(`broker answered ${response.status} for ${init.method} ${path}`)
  }
  return response.json() as Promise<unknown>
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

import { MediaJobSchema, requireEnv } from '@boom-busters/schemas'
import type { MediaJob } from '@boom-busters/schemas'

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

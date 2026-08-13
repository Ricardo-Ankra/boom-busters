import 'server-only'

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { hasEnvGroup, requireEnv, ValidationError } from '@boom-busters/schemas'

/**
 * Cloudflare R2, through the S3 SDK (build spec section 2).
 *
 * Design principle 2 is the shape of this module: "all media flows R2/S3 ↔
 * Lambda via presigned URLs". The browser is never handed bytes by the app — it
 * is handed a short-lived URL and fetches the object from R2 directly, so a
 * review screen playing sixty paragraphs of narration costs the web layer
 * sixty redirects rather than sixty megabytes of proxying.
 *
 * The write side is the one place the app does hold audio, and only for as long
 * as a `PutObject` takes: the TTS vendors answer over HTTP into the Inngest
 * function, and until media-utils exists (M6) there is nowhere else for the
 * response to go. `packages/providers/src/tts/audio.ts` explains why that is
 * acceptable and what it deliberately does not do.
 *
 * **Keys, never URLs, are what gets stored.** Section 8.2 makes this critical
 * for timelines and the same rule applies here: a presigned URL expires, so a
 * `voice_takes.r2Key` holding one would break the day after it was written.
 */

/** Every key this app writes lives under one prefix (spec section 3 naming). */
export const R2_PREFIX = 'boom-busters'

/**
 * `MOCK_KEY_PREFIX`, `isMockKey` and `mockVoiceTakeKey` live in
 * `packages/db/src/voice.ts`, beside the column they are written into: the
 * runner, the audio route and the E2E seed all have to agree on the shape, and
 * the seed cannot import from `apps/web`.
 */

/** How long a playback URL lives. Long enough to listen through a chapter. */
export const PLAYBACK_URL_TTL_SEC = 60 * 60

let cached: { client: S3Client; bucket: string } | undefined

/**
 * The S3 client for R2, built on first use rather than at import.
 *
 * R2 is a deferred env group (spec section 4): M1-M3 boot and run without it,
 * and it must fail at the moment narration is first stored, naming the missing
 * keys — not at import time, which would take the whole app down for a stage
 * nobody has reached yet.
 */
export function r2(): { client: S3Client; bucket: string } {
  if (cached) return cached

  const env = requireEnv('r2')

  cached = {
    client: new S3Client({
      // R2 has no regions; the SDK insists on one and "auto" is what
      // Cloudflare's own documentation passes.
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    }),
    bucket: env.R2_BUCKET,
  }

  return cached
}

/** Whether object storage is configured at all — for status chips and skips. */
export function storageConfigured(): boolean {
  return hasEnvGroup('r2')
}

/** Where a bought take's bytes go. */
export type TakeStorage =
  /** Uploaded to R2, and the take holds the key. */
  | 'r2'
  /** The mock made them, so the audio route re-derives them on play. */
  | 'regenerated'

/**
 * Where the next take's audio can be put — or a refusal to buy it.
 *
 * This exists because of a bug that cost real money and produced narration that
 * was not narration. The runner used to choose the `mock://` key whenever R2 was
 * absent:
 *
 *     const key = storageConfigured() ? (await putObject(...)).key
 *                                     : mockVoiceTakeKey(take.id)
 *
 * which reads as "no bucket, so nothing to upload" and was written for
 * `MOCK_PROVIDERS=1`, where there genuinely is nothing to upload. But the
 * condition is about the *bucket*, and the audio route's condition is about the
 * *provider*: it treats any `mock://` key as a mock take and regenerates the
 * bytes from `mockNarrationPcm`. Put a live provider behind an unconfigured
 * bucket and the two disagree — every paragraph was synthesised by Google,
 * charged at Chirp's rate, thrown away unstored, and then played back as the
 * mock's tone bursts. The waveform strip above the player was drawn from the
 * real audio, so the screen showed speech and the speaker produced beeps.
 *
 * `mock://` now means one thing only: **the mock made this**. Live providers
 * with nowhere to store the result is not a fallback, it is a configuration
 * error, and it is raised before the first character is paid for.
 */
export function takeStorage(): TakeStorage {
  if (storageConfigured()) return 'r2'
  if (mockProvidersEnabled()) return 'regenerated'

  throw new ValidationError(
    'Narration has nowhere to be stored. R2 is not configured and the providers are live, so ' +
      'every paragraph would be bought from the vendor and then discarded. Set R2_ACCOUNT_ID, ' +
      'R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET, or set MOCK_PROVIDERS=1 to run the ' +
      'stage without spending anything.',
    { field: 'env.R2_BUCKET' },
  )
}

/**
 * Where a take's audio lives.
 *
 * The take id is in the key rather than only the paragraph coordinates, so a
 * retake never overwrites the take it is being compared against — losing the
 * original the moment its replacement arrives would make the A/B toggle a lie.
 */
export function voiceTakeKey(input: {
  projectId: string
  chapterId: string
  paragraphIndex: number
  takeId: string
}): string {
  const paragraph = String(input.paragraphIndex).padStart(3, '0')
  return `${R2_PREFIX}/voice/${input.projectId}/${input.chapterId}/${paragraph}-${input.takeId}.wav`
}

/** Where an audition sample lives — kept for later comparison (spec §10.1). */
export function auditionKey(input: { provider: string; voiceId: string; hash: string }): string {
  return `${R2_PREFIX}/auditions/${input.provider}/${encodeURIComponent(input.voiceId)}/${input.hash}.wav`
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ key: string }> {
  const { client, bucket } = r2()

  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )

  return { key }
}

/** A short-lived URL the browser can fetch the object from directly. */
export async function presignGet(key: string, ttlSec = PLAYBACK_URL_TTL_SEC): Promise<string> {
  const { client, bucket } = r2()
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: ttlSec,
  })
}

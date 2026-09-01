'use server'

import {
  deleteMusicBed,
  insertMusicBed,
  llmCredentials,
  recordVerifyResult,
  setCredential,
  ttsCredential,
  updateSettings,
  visualCredentials,
} from '@boom-busters/db'
import {
  falImageGen,
  llmAdapters,
  mockProvidersEnabled,
  stockAdapter,
  ttsAdapter,
} from '@boom-busters/providers'
import {
  LlmProviderSchema,
  MUSIC_ATTRIBUTION_MAX_CHARS,
  MUSIC_MAX_BYTES,
  MusicLicenceSchema,
  ProviderSchema,
  SettingsPatchSchema,
  isRetriable,
  type Settings,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { deleteObject, headObject, musicKey, presignPut, storageConfigured } from '@/lib/storage'

/**
 * Settings CRUD. Every action re-checks the session server-side: the proxy
 * protects page navigation, but a server action is a POST endpoint of its own
 * and must not rely on that.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

export async function saveSettings(patch: unknown): Promise<ActionResult> {
  await requireOwner()

  // Validate at the edge, not just at the database (spec section 2: Zod
  // everywhere, at API edges).
  const parsed = SettingsPatchSchema.safeParse(patch)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid settings',
    }
  }

  try {
    await updateSettings(db, parsed.data)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save settings' }
  }

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

export async function saveProviderKey(provider: string, apiKey: string): Promise<ActionResult> {
  await requireOwner()

  const parsedProvider = ProviderSchema.safeParse(provider)
  if (!parsedProvider.success) return { ok: false, error: `Unknown provider "${provider}"` }

  const trimmed = apiKey.trim()
  if (trimmed === '') return { ok: false, error: 'Enter a key' }

  // Encrypted with SECRETS_ENCRYPTION_KEY and never returned to the client
  // again — the UI only ever sees the masked hint (spec section 4).
  await setCredential(db, parsedProvider.data, trimmed, env.SECRETS_ENCRYPTION_KEY)

  revalidatePath('/settings')
  return { ok: true }
}

export interface VerifyResult extends ActionResult {
  /** True when the key was proven against the vendor, not merely stored. */
  verified?: boolean
  /** Set when the call was answered by a mock rather than the vendor. */
  mocked?: boolean
}

/**
 * The `Verify` button (build spec section 11.3).
 *
 * M1 deferred this to M3 because it needs the provider adapters; the adapters
 * landed with M3 and this closes the loop. Until it existed every stored key
 * read `unchecked` forever, which is indistinguishable from a key that does
 * not work — and finding that out mid-pipeline is exactly what the router's
 * pre-flight was built to avoid.
 *
 * It calls the adapter's cheapest endpoint. That costs a fraction of a cent
 * against a real key, which is the point: a health check nobody can afford to
 * press is not a health check.
 */

/**
 * Which providers can be verified, and through which adapter.
 *
 * The LLM vendors verify through their LLM adapters; `elevenlabs` is the one
 * TTS account and verifies through its own free voices call.
 */
async function verifiableKey(
  provider: string,
): Promise<{ verify: (apiKey: string) => Promise<void>; apiKey: string | undefined } | undefined> {
  const llm = LlmProviderSchema.safeParse(provider)
  if (llm.success) {
    const keys = await llmCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    const adapter = llmAdapters()[llm.data]
    return { verify: (apiKey) => adapter.verifyKey(apiKey), apiKey: keys[llm.data] }
  }

  // The one TTS account.
  if (provider === 'elevenlabs') {
    const adapter = ttsAdapter(provider)
    return {
      verify: (apiKey) => adapter.verifyKey(apiKey),
      apiKey: await ttsCredential(db, provider, env.SECRETS_ENCRYPTION_KEY),
    }
  }

  // The visuals-stage providers (M5). Stock verifies through a one-result
  // search; fal through its auth-before-method check — none of them spend.
  if (provider === 'pexels' || provider === 'pixabay' || provider === 'fal') {
    const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    const verify =
      provider === 'fal'
        ? (apiKey: string) =>
            mockProvidersEnabled() ? Promise.resolve() : falImageGen.verifyKey(apiKey)
        : (apiKey: string) => stockAdapter(provider).verifyKey(apiKey)
    return { verify, apiKey: keys[provider] }
  }

  return undefined
}

export async function verifyProviderKey(provider: string): Promise<VerifyResult> {
  await requireOwner()

  const parsedProvider = ProviderSchema.safeParse(provider)
  if (!parsedProvider.success) return { ok: false, error: `Unknown provider "${provider}"` }

  const verifiable = await verifiableKey(parsedProvider.data)
  if (!verifiable) {
    return {
      ok: false,
      error: `Verifying ${provider} is not supported yet — it has no adapter to ping.`,
    }
  }

  if (!verifiable.apiKey) {
    return { ok: false, error: 'No key is stored for that provider yet.' }
  }

  const mocked = mockProvidersEnabled()

  try {
    await verifiable.verify(verifiable.apiKey)
    await recordVerifyResult(db, parsedProvider.data, 'ok')
    revalidatePath('/settings')
    return { ok: true, verified: true, mocked }
  } catch (error) {
    // A wrong key, a revoked key and a provider outage are different problems
    // and the chip cannot tell them apart, so only a refusal is recorded as
    // `invalid`. Marking a key invalid because Anthropic had a bad minute
    // would send you rotating a key that was fine.
    const transient = isRetriable(error)
    if (!transient) await recordVerifyResult(db, parsedProvider.data, 'invalid')

    revalidatePath('/settings')
    return {
      ok: false,
      verified: false,
      mocked,
      error: transient
        ? `${provider} could not be reached, so the key is still unchecked: ${
            error instanceof Error ? error.message : String(error)
          }`
        : error instanceof Error
          ? error.message
          : 'The key was refused',
    }
  }
}

export type { Settings }

// ---------------------------------------------------------------------------
// Music library (M6.4, spec section 10.1)
// ---------------------------------------------------------------------------

/** Upload MIME type → stored extension. */
const MUSIC_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
}

/**
 * Music uploads go browser → R2 directly, in two actions (decision 205).
 *
 * The bytes cannot come through here: Vercel rejects request bodies over
 * about 4.5 MB at its edge, before any action runs, and a music bed is
 * routinely 5-10 MB. So the browser asks for a presigned PUT URL, sends the
 * bytes to R2 itself, and then asks for the row — the app handles two small
 * JSON round-trips and never a byte of audio.
 *
 * The content hash is computed in the browser (crypto.subtle over the same
 * bytes that get uploaded). It is trusted for what it is used for — picking
 * the storage key so identical tracks dedupe — because this is a single-owner
 * console and the only person who could lie about it is the owner, to
 * themselves. The finalise step still verifies with its own eyes that an
 * object of a legal size actually exists at the key before writing a row.
 */
export async function createMusicUploadAction(input: {
  fileType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()

  const extension = MUSIC_EXTENSIONS[input.fileType]
  if (!extension) {
    return { ok: false, error: 'Only MP3, WAV, M4A or OGG audio can be uploaded here.' }
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > MUSIC_MAX_BYTES) {
    return { ok: false, error: 'That file is over the 25 MB limit for music beds.' }
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Uploads need R2 configured — there is nowhere to store audio.' }
  }

  const key = musicKey({ contentHash: input.contentHash, ext: extension })
  return { ok: true, url: await presignPut(key, input.fileType), key }
}

export async function finaliseMusicBedAction(input: {
  key: string
  contentHash: string
  title: string
  licence: string
  moodTags: string
  /**
   * Attribution/licence text (decision 207) — published verbatim in the
   * YouTube description of every video that uses this track, so the licence
   * ships with the upload instead of waiting for a Content ID dispute.
   */
  attributionText?: string
}): Promise<ActionResult> {
  await requireOwner()

  // The licence is REQUIRED, and it is a human statement, not metadata: the
  // app never fetches music, so the human who downloaded the track is the
  // only one who knows what right they have to use it.
  const licence = MusicLicenceSchema.safeParse(input.licence)
  if (!licence.success) {
    return { ok: false, error: 'Choose the licence this track was downloaded under.' }
  }

  // Only keys this flow could have issued: a content-hash music key. Anything
  // else is not a music upload, whatever the caller says it is.
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  const expectedPrefix = musicKey({ contentHash: input.contentHash, ext: '' })
  if (!input.key.startsWith(expectedPrefix)) {
    return { ok: false, error: 'That upload does not match its fingerprint. Start again.' }
  }

  if (!storageConfigured()) {
    return { ok: false, error: 'Uploads need R2 configured — there is nowhere to store audio.' }
  }

  // Verified against the bucket, not against the caller's word: the row is a
  // promise that the preview player can stream this key.
  const head = await headObject(input.key)
  if (!head) {
    return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  }
  if (head.size > MUSIC_MAX_BYTES) {
    await deleteObject(input.key)
    return { ok: false, error: 'That file is over the 25 MB limit for music beds.' }
  }

  const title = input.title.trim() || 'Untitled bed'
  const moodTags = input.moodTags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  const attributionText = (input.attributionText ?? '').trim()
  if (attributionText.length > MUSIC_ATTRIBUTION_MAX_CHARS) {
    return {
      ok: false,
      error:
        `The licence text is over ${MUSIC_ATTRIBUTION_MAX_CHARS} characters. It is published in ` +
        'every YouTube description that uses this track, and the description has a 5000-character ' +
        'ceiling to share.',
    }
  }

  await insertMusicBed(db, {
    r2Key: input.key,
    contentHash: input.contentHash,
    title,
    licence: licence.data,
    moodTags,
    attributionText: attributionText || null,
  })

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

export async function deleteMusicBedAction(id: string): Promise<ActionResult> {
  await requireOwner()

  const row = await deleteMusicBed(db, id)
  if (!row) return { ok: false, error: 'That track is already gone.' }

  // Best-effort: the row is authoritative and already deleted; bytes left
  // behind are a lifecycle-rule concern, not a correctness one.
  try {
    await deleteObject(row.r2Key)
  } catch {
    // Deliberately swallowed — see above.
  }

  revalidatePath('/settings')
  revalidatePath('/')
  return { ok: true }
}

/**
 * The YouTube card's Verify (build spec section 9): mint a short-lived
 * access token from the stored refresh token and ping `channels.list` —
 * the same health check the daily ping will run from the M8 cron. An
 * `invalid_grant` means the refresh token is dead (consent revoked) and
 * only reconnecting helps; the chip says so.
 */
export async function verifyYoutubeConnection(): Promise<
  ActionResult & { channelTitle?: string; needsReconnect?: boolean }
> {
  await requireOwner()

  const { youtubeRefreshToken } = await import('@boom-busters/db')
  const { pingChannel, refreshAccessToken, YoutubeAuthError, youtubeConfigured } =
    await import('@/lib/youtube')

  if (!youtubeConfigured()) {
    return {
      ok: false,
      error: 'Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in the environment first.',
    }
  }

  const refreshToken = await youtubeRefreshToken(db, env.SECRETS_ENCRYPTION_KEY)
  if (!refreshToken) {
    return { ok: false, error: 'YouTube is not connected yet.' }
  }

  try {
    const grant = await refreshAccessToken(refreshToken)
    const ping = await pingChannel(grant.accessToken)
    await recordVerifyResult(db, 'youtube', ping.ok ? 'ok' : 'invalid')
    revalidatePath('/settings')
    if (!ping.ok) return { ok: false, error: ping.error ?? 'The channel ping failed.' }
    return { ok: true, ...(ping.channelTitle ? { channelTitle: ping.channelTitle } : {}) }
  } catch (error) {
    await recordVerifyResult(db, 'youtube', 'invalid')
    revalidatePath('/settings')
    if (error instanceof YoutubeAuthError && error.needsReconnect) {
      return {
        ok: false,
        needsReconnect: true,
        error: 'Google no longer honours the stored consent - reconnect YouTube.',
      }
    }
    return { ok: false, error: 'Could not reach Google to verify the connection.' }
  }
}

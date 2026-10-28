import {
  ChannelNotFoundError,
  FIRST_CHANNEL_ID,
  PROVIDER_ENV_SEEDS,
  TTS_CREDENTIAL_PROVIDER,
} from '@boom-busters/schemas'
import type {
  LlmProvider,
  Provider,
  Settings,
  SettingsPatch,
  TtsProvider,
} from '@boom-busters/schemas'
import { count, eq, inArray } from 'drizzle-orm'
import { ensureFirstChannel, getChannelSettings, updateChannelSettings } from './channels'
import type { Database } from './client'
import { decryptSecret, encryptSecret, keyHint, maskKey } from './crypto'
import { assets, cases, providerCredentials } from './schema'
import { getWorkspace, updateWorkspace } from './workspace'
import {
  channelYoutubeConnected,
  channelYoutubeReconnectNeeded,
  channelYoutubeToken,
  channelYoutubeConnection,
  recordChannelYoutubeVerify,
  saveChannelYoutubeConnection,
} from './youtube-connections'

// ---------------------------------------------------------------------------
// Settings: the first channel's, with the workspace's prices and budget
// ---------------------------------------------------------------------------

/**
 * The first channel's settings, creating the channel on first access as the
 * settings row used to be, so no caller of the old name grows a "not
 * configured yet" branch.
 */
async function firstChannelSettings(db: Database): Promise<Settings> {
  try {
    return await getChannelSettings(db, FIRST_CHANNEL_ID)
  } catch (error) {
    if (!(error instanceof ChannelNotFoundError)) throw error
    return (await ensureFirstChannel(db)).settings
  }
}

/** @deprecated transitional, deleted in Task 8 */
export async function getSettings(db: Database): Promise<Settings> {
  const channelSettings = await firstChannelSettings(db)
  const { settings: workspaceSettings } = await getWorkspace(db)
  return {
    ...channelSettings,
    modelPrices: workspaceSettings.modelPrices,
    budgets: workspaceSettings.budgets,
  }
}

/** @deprecated transitional, deleted in Task 8 */
export async function updateSettings(db: Database, patch: SettingsPatch): Promise<Settings> {
  const { modelPrices, budgets, ...channelPatch } = patch
  // The channel first: its merge is the one that can refuse a patch, and a
  // refused patch must leave the workspace untouched too.
  await firstChannelSettings(db)
  await updateChannelSettings(db, FIRST_CHANNEL_ID, channelPatch)
  if (modelPrices !== undefined || budgets !== undefined) {
    await updateWorkspace(db, {
      ...(modelPrices === undefined ? {} : { modelPrices }),
      ...(budgets === undefined ? {} : { budgets }),
    })
  }
  return getSettings(db)
}

// ---------------------------------------------------------------------------
// Provider credentials
// ---------------------------------------------------------------------------

export interface MaskedCredential {
  provider: Provider | 'remotion'
  masked: string
  verifyStatus: 'ok' | 'invalid' | 'unchecked'
  lastVerifiedAt: Date | null
}

/**
 * `youtube` is still a value of the provider enum, so the old names accept
 * it; it now means the first channel's connection (multi-channel design,
 * section 4.2), deleted with the wrappers in Task 7.
 */
type CredentialProvider = MaskedCredential['provider'] | 'youtube'

/**
 * Providers that exist in the database enum but no longer in the app.
 * Postgres cannot drop an enum value without rebuilding the type, so a
 * credential row saved for a retired vendor may still exist; it is filtered
 * on read rather than deleted, because a stored secret should outlive a
 * product decision that might yet be reversed. `youtube` is here because it
 * is a per-channel connection now, never a workspace credential.
 */
const RETIRED_PROVIDERS = new Set<string>(['google-cloud-tts', 'youtube'])

/** Never returns key material — only what Settings -> Connections may display. */
export async function listCredentials(db: Database): Promise<MaskedCredential[]> {
  const rows = await db
    .select({
      provider: providerCredentials.provider,
      keyHint: providerCredentials.keyHint,
      verifyStatus: providerCredentials.verifyStatus,
      lastVerifiedAt: providerCredentials.lastVerifiedAt,
    })
    .from(providerCredentials)

  return rows
    .filter(
      (row): row is typeof row & { provider: MaskedCredential['provider'] } =>
        !RETIRED_PROVIDERS.has(row.provider),
    )
    .map((row) => ({
      provider: row.provider,
      masked: maskKey(row.keyHint),
      verifyStatus: row.verifyStatus,
      lastVerifiedAt: row.lastVerifiedAt,
    }))
}

/**
 * Store a provider key. `youtube` is the first channel's connection now:
 * @deprecated transitional for `youtube`, deleted in Task 7
 */
export async function setCredential(
  db: Database,
  provider: CredentialProvider,
  apiKey: string,
  encryptionKey: string,
): Promise<void> {
  if (provider === 'youtube') {
    await ensureFirstChannel(db)
    return saveChannelYoutubeConnection(db, FIRST_CHANNEL_ID, {
      refreshToken: apiKey,
      encryptionKey,
      youtubeChannelId: null,
      youtubeChannelTitle: null,
    })
  }
  const encrypted = encryptSecret(apiKey, encryptionKey)
  await db
    .insert(providerCredentials)
    .values({
      provider,
      encryptedKey: encrypted,
      keyHint: keyHint(apiKey),
      verifyStatus: 'unchecked',
    })
    .onConflictDoUpdate({
      target: providerCredentials.provider,
      set: {
        encryptedKey: encrypted,
        keyHint: keyHint(apiKey),
        verifyStatus: 'unchecked',
        lastVerifiedAt: null,
        updatedAt: new Date(),
      },
    })
}

export async function hasCredential(db: Database, provider: CredentialProvider): Promise<boolean> {
  const [row] = await db
    .select({ id: providerCredentials.id })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, provider))
  return row !== undefined
}

/**
 * Import provider keys present in env into the database on first boot, so
 * local dev works without touching Settings -> Connections (spec section 4).
 * Env is a SEED only: an existing row always wins, and rotating a key in the
 * UI is never overwritten by a stale env var.
 */
export async function importProviderEnvSeeds(
  db: Database,
  encryptionKey: string,
  source: Record<string, string | undefined> = process.env,
): Promise<Provider[]> {
  const imported: Provider[] = []

  for (const [provider, envVar] of Object.entries(PROVIDER_ENV_SEEDS)) {
    const value = source[envVar]
    if (!value || value.trim() === '') continue
    if (await hasCredential(db, provider as Provider)) continue

    await setCredential(db, provider as Provider, value.trim(), encryptionKey)
    imported.push(provider as Provider)
  }

  return imported
}

// ---------------------------------------------------------------------------
// First-run setup checklist (spec section 11.3)
// ---------------------------------------------------------------------------

/** Music beds are user-uploaded assets; the checklist requires at least three. */
export async function countMusicBeds(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(assets).where(eq(assets.kind, 'music'))
  return row?.value ?? 0
}

export async function countCases(db: Database): Promise<number> {
  const [row] = await db.select({ value: count() }).from(cases)
  return row?.value ?? 0
}

/** @deprecated transitional, deleted in Task 7 */
export async function youtubeRefreshToken(
  db: Database,
  encryptionKey: string,
): Promise<string | undefined> {
  return channelYoutubeToken(db, FIRST_CHANNEL_ID, encryptionKey)
}

/**
 * The first channel's connection in the masked shape the Settings YouTube
 * card reads; never key material.
 * @deprecated transitional, deleted in Task 7
 */
export async function youtubeMaskedConnection(
  db: Database,
): Promise<Omit<MaskedCredential, 'provider'> | undefined> {
  const row = await channelYoutubeConnection(db, FIRST_CHANNEL_ID)
  if (!row) return undefined
  return {
    masked: maskKey(row.keyHint),
    verifyStatus: row.verifyStatus,
    lastVerifiedAt: row.lastVerifiedAt,
  }
}

/** @deprecated transitional, deleted in Task 7 */
export async function isYoutubeConnected(db: Database): Promise<boolean> {
  return channelYoutubeConnected(db, FIRST_CHANNEL_ID)
}

/** @deprecated transitional, deleted in Task 7 */
export async function youtubeReconnectNeeded(
  db: Database,
): Promise<{ needed: boolean; since: Date | null }> {
  return channelYoutubeReconnectNeeded(db, FIRST_CHANNEL_ID)
}

/**
 * Decrypted keys for the LLM providers, for the model router.
 *
 * Deliberately separate from `listCredentials`, which exists precisely so that
 * screens cannot get at key material. This one returns the real thing, so it
 * is only ever called server-side by the pipeline and by the Verify button.
 *
 * A key that cannot be decrypted is omitted rather than thrown on: it means
 * `SECRETS_ENCRYPTION_KEY` was rotated without re-entering the keys, and the
 * useful outcome is the router's pre-flight saying "anthropic has no working
 * API key" and pointing at Settings, not every screen 500ing.
 */
export async function llmCredentials(
  db: Database,
  encryptionKey: string,
): Promise<Partial<Record<LlmProvider, string>>> {
  const rows = await db
    .select({
      provider: providerCredentials.provider,
      encryptedKey: providerCredentials.encryptedKey,
    })
    .from(providerCredentials)
    .where(inArray(providerCredentials.provider, ['anthropic', 'openai', 'google']))

  const keys: Partial<Record<LlmProvider, string>> = {}
  for (const row of rows) {
    try {
      keys[row.provider as LlmProvider] = decryptSecret(row.encryptedKey, encryptionKey)
    } catch {
      // Left absent on purpose — see the note above.
    }
  }
  return keys
}

/**
 * The decrypted key a TTS provider needs, on the same terms as `llmCredentials`.
 *
 * Resolved through `TTS_CREDENTIAL_PROVIDER`. With one narrator the mapping
 * is the identity, but it stays: the column means "the account the spend
 * lands on", and the Gemini era proved those are not always the same name.
 */
export async function ttsCredential(
  db: Database,
  provider: TtsProvider,
  encryptionKey: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ encryptedKey: providerCredentials.encryptedKey })
    .from(providerCredentials)
    .where(eq(providerCredentials.provider, TTS_CREDENTIAL_PROVIDER[provider]))
    .limit(1)

  if (!row) return undefined

  try {
    return decryptSecret(row.encryptedKey, encryptionKey)
  } catch {
    // Absent rather than thrown, for the reason `llmCredentials` gives.
    return undefined
  }
}

/**
 * The keyed visual-asset providers — Wikimedia Commons needs none. `google`
 * is here because Gemini's image model is the default still generator: the
 * same key the LLM adapters use, read on the visuals stage's terms.
 */
export type VisualKeyProvider = 'pexels' | 'pixabay' | 'fal' | 'google'

/**
 * The decrypted keys the visuals stage may need, on the same terms as
 * `llmCredentials`: server-side only, and a key that cannot be decrypted is
 * omitted so the stage pre-flight can name the provider that needs re-entry.
 */
export async function visualCredentials(
  db: Database,
  encryptionKey: string,
): Promise<Partial<Record<VisualKeyProvider, string>>> {
  const rows = await db
    .select({
      provider: providerCredentials.provider,
      encryptedKey: providerCredentials.encryptedKey,
    })
    .from(providerCredentials)
    .where(inArray(providerCredentials.provider, ['pexels', 'pixabay', 'fal', 'google']))

  const keys: Partial<Record<VisualKeyProvider, string>> = {}
  for (const row of rows) {
    try {
      keys[row.provider as VisualKeyProvider] = decryptSecret(row.encryptedKey, encryptionKey)
    } catch {
      // Left absent on purpose — see `llmCredentials`.
    }
  }
  return keys
}

/**
 * Stamp the outcome of Settings -> Connections' Verify button. `youtube`
 * routes to the first channel's connection, transitionally until Task 7.
 */
export async function recordVerifyResult(
  db: Database,
  provider: CredentialProvider,
  status: 'ok' | 'invalid',
): Promise<void> {
  if (provider === 'youtube') return recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, status)
  await db
    .update(providerCredentials)
    .set({
      verifyStatus: status,
      lastVerifiedAt: status === 'ok' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(providerCredentials.provider, provider))
}

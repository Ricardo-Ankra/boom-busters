import {
  DEFAULT_SETTINGS,
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
import { and, count, eq, inArray } from 'drizzle-orm'
import type { Database } from './client'
import { decryptSecret, encryptSecret, keyHint, maskKey } from './crypto'
import { assets, cases, providerCredentials, settings as settingsTable } from './schema'
import { mergeSettings, normaliseSettings } from './settings-merge'

const SETTINGS_ID = 'singleton' as const

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Read the single settings row, creating it from defaults on first access.
 * Every caller therefore gets a complete, valid `Settings` — there is no
 * "settings not configured yet" branch to handle at the call site.
 */
export async function getSettings(db: Database): Promise<Settings> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, SETTINGS_ID))
  if (row) return normaliseSettings(row.value)

  await db
    .insert(settingsTable)
    .values({ id: SETTINGS_ID, value: DEFAULT_SETTINGS })
    .onConflictDoNothing()

  const [created] = await db.select().from(settingsTable).where(eq(settingsTable.id, SETTINGS_ID))
  return normaliseSettings(created?.value ?? DEFAULT_SETTINGS)
}

/**
 * Apply a validated patch. Read-merge-write rather than a JSONB merge in SQL,
 * so the result passes `SettingsSchema` before it is stored — a settings row
 * that fails validation would break every consumer downstream.
 */
export async function updateSettings(db: Database, patch: SettingsPatch): Promise<Settings> {
  const current = await getSettings(db)
  const next = mergeSettings(current, patch)

  await db
    .insert(settingsTable)
    .values({ id: SETTINGS_ID, value: next })
    .onConflictDoUpdate({ target: settingsTable.id, set: { value: next, updatedAt: new Date() } })

  return next
}

// ---------------------------------------------------------------------------
// Provider credentials
// ---------------------------------------------------------------------------

export interface MaskedCredential {
  provider: Provider | 'youtube' | 'remotion'
  masked: string
  verifyStatus: 'ok' | 'invalid' | 'unchecked'
  lastVerifiedAt: Date | null
}

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

  return rows.map((row) => ({
    provider: row.provider,
    masked: maskKey(row.keyHint),
    verifyStatus: row.verifyStatus,
    lastVerifiedAt: row.lastVerifiedAt,
  }))
}

export async function setCredential(
  db: Database,
  provider: MaskedCredential['provider'],
  apiKey: string,
  encryptionKey: string,
): Promise<void> {
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

export async function deleteCredential(
  db: Database,
  provider: MaskedCredential['provider'],
): Promise<void> {
  await db.delete(providerCredentials).where(eq(providerCredentials.provider, provider))
}

export async function hasCredential(
  db: Database,
  provider: MaskedCredential['provider'],
): Promise<boolean> {
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

export async function isYoutubeConnected(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ id: providerCredentials.id })
    .from(providerCredentials)
    .where(
      and(eq(providerCredentials.provider, 'youtube'), eq(providerCredentials.verifyStatus, 'ok')),
    )
  return row !== undefined
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
 * Resolved through `TTS_CREDENTIAL_PROVIDER`, because "gemini" is a model line
 * rather than an account: its TTS endpoint takes the same Google key as the
 * Gemini text models. Looking for a credential row called `gemini` would find
 * nothing and report a missing key that has been configured all along.
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

/** Stamp the outcome of Settings -> Connections' Verify button. */
export async function recordVerifyResult(
  db: Database,
  provider: MaskedCredential['provider'],
  status: 'ok' | 'invalid',
): Promise<void> {
  await db
    .update(providerCredentials)
    .set({
      verifyStatus: status,
      lastVerifiedAt: status === 'ok' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(providerCredentials.provider, provider))
}

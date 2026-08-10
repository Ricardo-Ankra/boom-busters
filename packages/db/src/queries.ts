import { DEFAULT_SETTINGS, PROVIDER_ENV_SEEDS } from '@boom-busters/schemas'
import type { Provider, Settings, SettingsPatch } from '@boom-busters/schemas'
import { and, count, eq } from 'drizzle-orm'
import type { Database } from './client'
import { encryptSecret, keyHint, maskKey } from './crypto'
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

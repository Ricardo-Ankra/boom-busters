'use server'

import {
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
  ProviderSchema,
  SettingsPatchSchema,
  isRetriable,
  type Settings,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

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
        ? (apiKey: string) => (mockProvidersEnabled() ? Promise.resolve() : falImageGen.verifyKey(apiKey))
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

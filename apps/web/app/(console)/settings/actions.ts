'use server'

import { setCredential, updateSettings } from '@boom-busters/db'
import { ProviderSchema, SettingsPatchSchema, type Settings } from '@boom-busters/schemas'
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

export type { Settings }

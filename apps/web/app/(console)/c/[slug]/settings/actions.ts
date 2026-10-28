'use server'

import { updateChannelSettings } from '@boom-busters/db'
import { SettingsPatchSchema, UlidSchema } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * Channel settings CRUD. Every action re-checks the session server-side: the
 * proxy protects page navigation, but a server action is a POST endpoint of
 * its own and must not rely on that. Provider keys, prices, the budget and the
 * music library are the workspace's, in `/settings/workspace-actions`.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

export async function saveSettings(channelId: string, patch: unknown): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

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
    await updateChannelSettings(db, channelId, parsed.data)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save settings' }
  }

  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * The YouTube card's Verify (build spec section 9): mint a short-lived
 * access token from the stored refresh token and ping `channels.list` —
 * the same health check the daily ping will run from the M8 cron. An
 * `invalid_grant` means the refresh token is dead (consent revoked) and
 * only reconnecting helps; the chip says so.
 */
export async function verifyYoutubeConnection(
  channelId: string,
): Promise<ActionResult & { channelTitle?: string; needsReconnect?: boolean }> {
  await requireOwner()

  const { channelYoutubeConnected, channelYoutubeToken, recordChannelYoutubeVerify } =
    await import('@boom-busters/db')
  const { pingChannel, refreshAccessToken, YoutubeAuthError, youtubeConfigured } =
    await import('@/lib/youtube')

  if (!youtubeConfigured()) {
    return {
      ok: false,
      error: 'Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in the environment first.',
    }
  }

  const refreshToken = await channelYoutubeToken(db, channelId, env.SECRETS_ENCRYPTION_KEY)
  if (!refreshToken) {
    return { ok: false, error: 'YouTube is not connected yet.' }
  }

  try {
    const grant = await refreshAccessToken(refreshToken)
    const ping = await pingChannel(grant.accessToken)
    await recordChannelYoutubeVerify(db, channelId, ping.ok ? 'ok' : 'invalid', ping.channelId)
    revalidatePath('/c/[slug]', 'layout')
    if (!ping.ok) return { ok: false, error: ping.error ?? 'The channel ping failed.' }
    if (!(await channelYoutubeConnected(db, channelId))) {
      // The store writes `invalid` when the ping names another YouTube channel.
      return {
        ok: false,
        needsReconnect: true,
        error: 'The connected YouTube channel changed - reconnect the right account.',
      }
    }
    return { ok: true, ...(ping.channelTitle ? { channelTitle: ping.channelTitle } : {}) }
  } catch (error) {
    await recordChannelYoutubeVerify(db, channelId, 'invalid')
    revalidatePath('/c/[slug]', 'layout')
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

import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from './client'
import { decryptSecret, encryptSecret, keyHint } from './crypto'
import { channels, youtubeConnections } from './schema'
import type { YoutubeConnectionRow } from './schema'

/**
 * Each channel's YouTube connection (multi-channel design, section 4.2).
 *
 * One OAuth grant per channel, because every channel uploads to its own
 * YouTube account. The refresh token is encrypted like a provider key and
 * only the web app ever decrypts it; media-utils gets short-lived access
 * tokens minted from it, never the token itself (spec section 9).
 *
 * The stored `youtubeChannelId` closes decision 228's hole: a verify that
 * finds the grant now answers for a different YouTube channel marks the
 * connection invalid instead of letting a video go to the wrong account.
 */

export async function channelYoutubeConnection(
  db: Database,
  channelId: string,
): Promise<YoutubeConnectionRow | undefined> {
  const [row] = await db
    .select()
    .from(youtubeConnections)
    .where(eq(youtubeConnections.channelId, channelId))
    .limit(1)
  return row
}

/** Store a fresh grant. It starts `unchecked` until a verify stamps it. */
export async function saveChannelYoutubeConnection(
  db: Database,
  channelId: string,
  input: {
    refreshToken: string
    encryptionKey: string
    youtubeChannelId: string | null
    youtubeChannelTitle: string | null
  },
): Promise<void> {
  const values = {
    encryptedRefreshToken: encryptSecret(input.refreshToken, input.encryptionKey),
    keyHint: keyHint(input.refreshToken),
    youtubeChannelId: input.youtubeChannelId,
    youtubeChannelTitle: input.youtubeChannelTitle,
    verifyStatus: 'unchecked' as const,
    lastVerifiedAt: null,
  }
  await db
    .insert(youtubeConnections)
    .values({ channelId, ...values })
    .onConflictDoUpdate({
      target: youtubeConnections.channelId,
      set: { ...values, updatedAt: new Date() },
    })
}

/**
 * The decrypted refresh token, absent rather than thrown when there is none
 * or it cannot be decrypted (a rotated SECRETS_ENCRYPTION_KEY): the useful
 * outcome is a "reconnect YouTube" prompt, not a 500.
 */
export async function channelYoutubeToken(
  db: Database,
  channelId: string,
  encryptionKey: string,
): Promise<string | undefined> {
  const row = await channelYoutubeConnection(db, channelId)
  if (!row) return undefined
  try {
    return decryptSecret(row.encryptedRefreshToken, encryptionKey)
  } catch {
    return undefined
  }
}

export async function channelYoutubeConnected(db: Database, channelId: string): Promise<boolean> {
  return (await channelYoutubeConnection(db, channelId))?.verifyStatus === 'ok'
}

/**
 * Whether the connection is known-dead: its last verify came back invalid.
 * Drives the "Reconnect YouTube" Needs-you card. `since` is `updatedAt`,
 * not `lastVerifiedAt`: the invalid stamp nulls the verify time, and the
 * card's age is "since the stamp", which is that write.
 */
export async function channelYoutubeReconnectNeeded(
  db: Database,
  channelId: string,
): Promise<{ needed: boolean; since: Date | null }> {
  const row = await channelYoutubeConnection(db, channelId)
  const needed = row?.verifyStatus === 'invalid'
  return { needed, since: needed ? row.updatedAt : null }
}

/**
 * Stamp a verify (connect time, the publish pre-flight, the daily ping). An
 * `ok` that names a YouTube channel other than the stored one is written as
 * `invalid`; an `ok` on a connection that has no id yet records the one it
 * names.
 */
export async function recordChannelYoutubeVerify(
  db: Database,
  channelId: string,
  status: 'ok' | 'invalid',
  youtubeChannelId?: string,
): Promise<void> {
  const row = await channelYoutubeConnection(db, channelId)
  if (!row) return

  const changed =
    status === 'ok' &&
    youtubeChannelId !== undefined &&
    row.youtubeChannelId !== null &&
    row.youtubeChannelId !== youtubeChannelId
  const verifyStatus = changed ? 'invalid' : status

  await db
    .update(youtubeConnections)
    .set({
      verifyStatus,
      lastVerifiedAt: verifyStatus === 'ok' ? new Date() : null,
      youtubeChannelId:
        row.youtubeChannelId ?? (verifyStatus === 'ok' ? youtubeChannelId : null) ?? null,
      updatedAt: new Date(),
    })
    .where(eq(youtubeConnections.channelId, channelId))
}

/** Channels with a verified connection, archived ones left out: the analytics loop's list. */
export async function connectedChannelIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: channels.id })
    .from(youtubeConnections)
    .innerJoin(channels, eq(channels.id, youtubeConnections.channelId))
    .where(and(eq(youtubeConnections.verifyStatus, 'ok'), isNull(channels.archivedAt)))
    .orderBy(asc(channels.createdAt), asc(channels.id))
  return rows.map((row) => row.id)
}

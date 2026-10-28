import { getChannel } from '@boom-busters/db'
import type { Channel } from '@boom-busters/db'
import { ChannelNotFoundError } from '@boom-busters/schemas'
import { CHANNEL_ARCHIVED_MESSAGE } from './channel-archived'
import { db } from './db'

/**
 * The channel an action was handed, or null when a well-formed id names none.
 * Only a missing channel is caught: a database failure must reach the caller,
 * not read as "unknown channel".
 */
export async function findChannel(channelId: string): Promise<Channel | null> {
  try {
    return await getChannel(db, channelId)
  } catch (error) {
    if (error instanceof ChannelNotFoundError) return null
    throw error
  }
}

/**
 * Why a write to this channel must not go ahead, or null when it may: a
 * well-formed id that names no channel, or a channel that is archived (an
 * archived channel is read-only). One place, so no action repeats the check.
 */
export async function channelWriteRefusal(
  channelId: string,
): Promise<{ ok: false; error: string } | null> {
  return writeRefusalFor(await findChannel(channelId))
}

/** `channelWriteRefusal` for a caller that already holds the channel. */
export function writeRefusalFor(
  channel: Pick<Channel, 'archivedAt'> | null | undefined,
): { ok: false; error: string } | null {
  if (!channel) return { ok: false, error: 'Unknown channel' }
  if (channel.archivedAt !== null) return { ok: false, error: CHANNEL_ARCHIVED_MESSAGE }
  return null
}

import { getChannel } from '@boom-busters/db'
import type { Channel } from '@boom-busters/db'
import { ChannelNotFoundError } from '@boom-busters/schemas'
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

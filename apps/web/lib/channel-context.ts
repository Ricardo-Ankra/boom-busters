import {
  channelForProject,
  ensureFirstChannel,
  getChannel,
  getChannelBySlug,
  getWorkspace,
  type Channel,
} from '@boom-busters/db'
import { ChannelNotFoundError, ProjectNotFoundError } from '@boom-busters/schemas'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import 'server-only'
import { LAST_CHANNEL_COOKIE } from './channel-href'
import { db } from './db'

/** The channel a `/c/<slug>` URL names; an unknown slug is a 404. */
export async function channelFromSlug(slug: string): Promise<Channel> {
  const channel = await getChannelBySlug(db, slug)
  if (!channel) notFound()
  return channel
}

/** The channel a project belongs to; a missing project is a 404. */
export async function channelForProjectOrNotFound(projectId: string) {
  try {
    return await channelForProject(db, projectId)
  } catch (error) {
    if (error instanceof ProjectNotFoundError) notFound()
    throw error
  }
}

/**
 * Where `/` sends the owner: the channel last visited when it is still live,
 * else the workspace default, else the first channel (created if need be).
 */
export async function landingSlug(): Promise<string> {
  const remembered = (await cookies()).get(LAST_CHANNEL_COOKIE)?.value
  if (remembered) {
    const channel = await getChannelBySlug(db, remembered)
    if (channel && !channel.archivedAt) return channel.slug
  }

  const { defaultChannelId } = await getWorkspace(db)
  if (defaultChannelId) {
    try {
      return (await getChannel(db, defaultChannelId)).slug
    } catch (error) {
      // Only a default that names no row falls through to the first channel;
      // a database failure must not reach the write path below.
      if (!(error instanceof ChannelNotFoundError)) throw error
    }
  }
  return (await ensureFirstChannel(db)).slug
}

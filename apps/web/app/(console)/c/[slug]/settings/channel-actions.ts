'use server'

import {
  archiveChannel,
  createChannel,
  getChannel,
  getChannelBySlug,
  getWorkspace,
  listActiveRuns,
  listChannels,
  listOpenBudgetGates,
  listParkedRuns,
  listProjectsAwaitingReview,
  scheduledPublishItems,
  setDefaultChannel,
  updateChannel,
} from '@boom-busters/db'
import {
  ChannelBibleSchema,
  ChannelNotFoundError,
  ChannelSlugTakenError,
  CreateChannelInputSchema,
  DEFAULT_SETTINGS,
  RESERVED_SLUGS,
  UlidSchema,
} from '@boom-busters/schemas'
import type { Settings } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/auth'
import { LAST_CHANNEL_COOKIE } from '@/lib/channel-href'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import type { ActionResult } from './actions'

/**
 * The Channel tab's actions: create, edit and archive a channel. Each is a
 * POST endpoint of its own, so each re-checks the session.
 */

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const UNKNOWN_CHANNEL: ActionResult = { ok: false, error: 'Unknown channel' }

/** What a new channel takes from the channel it is copied from, and nothing else. */
function copiedSettings(source: Settings): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    brandKit: {
      ...structuredClone(source.brandKit),
      // The mark lives in the source channel's own logo library.
      look: { ...structuredClone(source.brandKit.look), logoR2Key: null },
    },
    tts: structuredClone(source.tts),
    modelRouting: structuredClone(source.modelRouting),
    fallbackChain: structuredClone(source.fallbackChain),
    render: structuredClone(source.render),
    publish: structuredClone(source.publish),
  }
}

export async function createChannelAction(
  input: unknown,
): Promise<ActionResult & { slug?: string }> {
  await requireOwner()

  const slugInput =
    typeof input === 'object' && input !== null ? (input as { slug?: unknown }).slug : undefined
  if (typeof slugInput === 'string' && (RESERVED_SLUGS as readonly string[]).includes(slugInput)) {
    return { ok: false, error: 'That address is reserved' }
  }

  const parsed = CreateChannelInputSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error:
        issue?.path[0] === 'slug'
          ? 'Use lower-case letters, digits and dashes for the address, up to 40 characters'
          : (issue?.message ?? 'That channel is not valid'),
    }
  }
  const { name, handle, slug, startFrom } = parsed.data

  let settings: Settings = structuredClone(DEFAULT_SETTINGS)
  if (startFrom !== 'defaults') {
    try {
      settings = copiedSettings((await getChannel(db, startFrom.copyFromChannelId)).settings)
    } catch (error) {
      if (error instanceof ChannelNotFoundError) return UNKNOWN_CHANNEL
      throw error
    }
  }

  // Archived channels keep their address, so this covers them too.
  if (await getChannelBySlug(db, slug)) return { ok: false, error: 'That address is taken' }

  try {
    await createChannel(db, {
      name,
      handle: handle === null || handle === '' ? null : handle,
      slug,
      settings,
      bible: ChannelBibleSchema.parse({}),
    })
  } catch (error) {
    if (error instanceof ChannelSlugTakenError) {
      return { ok: false, error: 'That address is taken' }
    }
    throw error
  }

  revalidatePath('/c/[slug]', 'layout')
  return { ok: true, slug }
}

const UpdateChannelSchema = z.object({
  name: z.string().trim().min(1, 'Give the channel a name').max(80).optional(),
  handle: z
    .string()
    .trim()
    .max(40)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  bible: ChannelBibleSchema.optional(),
})

export async function updateChannelAction(
  channelId: string,
  patch: unknown,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return UNKNOWN_CHANNEL
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const parsed = UpdateChannelSchema.safeParse(patch)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'That change is not valid',
    }
  }

  try {
    await updateChannel(db, channelId, parsed.data)
  } catch (error) {
    if (error instanceof ChannelNotFoundError) return UNKNOWN_CHANNEL
    throw error
  }

  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * Archive a channel after the owner types its address. Refused while anything
 * of the channel's own is in flight; the cron's rows that belong to no channel
 * never count. On success the workspace default moves off it if need be, the
 * last-channel cookie is cleared, and the slug to land on comes back.
 */
export async function archiveChannelAction(
  channelId: string,
  typedSlug: string,
): Promise<ActionResult & { slug?: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return UNKNOWN_CHANNEL

  let channel
  try {
    channel = await getChannel(db, channelId)
  } catch (error) {
    if (error instanceof ChannelNotFoundError) return UNKNOWN_CHANNEL
    throw error
  }

  if (typedSlug !== channel.slug) {
    return { ok: false, error: `Type ${channel.slug} exactly to confirm` }
  }

  const others = (await listChannels(db)).filter((entry) => entry.id !== channelId)
  const [oldestOther] = others
  if (!oldestOther) {
    return { ok: false, error: 'Create another channel before archiving this one' }
  }

  const [active, gates, parked, reviews, scheduled] = await Promise.all([
    listActiveRuns(db, channelId, { ownOnly: true }),
    listOpenBudgetGates(db, channelId, { ownOnly: true }),
    listParkedRuns(db, channelId),
    listProjectsAwaitingReview(db, channelId),
    scheduledPublishItems(db, channelId),
  ])
  if (active.length > 0) {
    return { ok: false, error: 'A run is still running for this channel. Wait for it to finish.' }
  }
  if (gates.length > 0) {
    return {
      ok: false,
      error: 'A budget gate is open for this channel. Resolve it on the dashboard first.',
    }
  }
  if (parked.length > 0) {
    return {
      ok: false,
      error: 'A run is parked at a gate for this channel. Approve or stop it first.',
    }
  }
  if (reviews.length > 0) {
    return {
      ok: false,
      error: 'A project is waiting on your review in this channel. Finish the review first.',
    }
  }
  if (scheduled.some((item) => item.status === 'scheduled')) {
    return {
      ok: false,
      error: 'A publish is scheduled for this channel. Unschedule it on the calendar first.',
    }
  }

  const { defaultChannelId } = await getWorkspace(db)
  const defaultStays = defaultChannelId !== null && others.some((e) => e.id === defaultChannelId)
  if (!defaultStays) await setDefaultChannel(db, oldestOther.id)
  await archiveChannel(db, channelId)

  const landing = defaultStays ? others.find((entry) => entry.id === defaultChannelId) : oldestOther
  ;(await cookies()).delete(LAST_CHANNEL_COOKIE)
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true, slug: (landing ?? oldestOther).slug }
}

import {
  ChannelBibleSchema,
  ChannelNotFoundError,
  ChannelSlugTakenError,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_HANDLE,
  FIRST_CHANNEL_ID,
  FIRST_CHANNEL_NAME,
  FIRST_CHANNEL_SLUG,
  ProjectNotFoundError,
} from '@boom-busters/schemas'
import type { ChannelBible, Settings, SettingsPatch } from '@boom-busters/schemas'
import { asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from './client'
import { channels, projects, workspace } from './schema'
import type { ChannelRow } from './schema'
import { mergeSettings, normaliseSettings } from './settings-merge'

/**
 * The channels the console produces for (multi-channel design, section 4).
 *
 * Every read hands back a `Channel` whose settings and bible are brought
 * forward to the current schemas, the way `normaliseSettings` always did for
 * the old settings row. Only the first channel is ever created implicitly, by
 * `ensureFirstChannel`; any other id that names no row is an error.
 */

export interface Channel {
  id: string
  slug: string
  name: string
  handle: string | null
  bible: ChannelBible
  settings: Settings
  archivedAt: Date | null
}

function toChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    handle: row.handle,
    bible: ChannelBibleSchema.parse(row.bible),
    settings: normaliseSettings(row.settings),
    archivedAt: row.archivedAt,
  }
}

/**
 * Create the first channel and the workspace row if they are missing, and
 * hand back the first channel. Safe to call on every boot and from every
 * test: each insert yields to a row already there, and a workspace row
 * without a default channel gets this one.
 */
export async function ensureFirstChannel(db: Database): Promise<Channel> {
  await db
    .insert(channels)
    .values({
      id: FIRST_CHANNEL_ID,
      slug: FIRST_CHANNEL_SLUG,
      name: FIRST_CHANNEL_NAME,
      handle: FIRST_CHANNEL_HANDLE,
      bible: FIRST_CHANNEL_BIBLE,
      settings: DEFAULT_SETTINGS,
    })
    .onConflictDoNothing({ target: channels.id })

  await db
    .insert(workspace)
    .values({
      id: 'singleton',
      value: DEFAULT_WORKSPACE_SETTINGS,
      defaultChannelId: FIRST_CHANNEL_ID,
    })
    .onConflictDoUpdate({
      target: workspace.id,
      set: { defaultChannelId: FIRST_CHANNEL_ID, updatedAt: new Date() },
      setWhere: isNull(workspace.defaultChannelId),
    })

  return getChannel(db, FIRST_CHANNEL_ID)
}

export async function getChannel(db: Database, channelId: string): Promise<Channel> {
  const [row] = await db.select().from(channels).where(eq(channels.id, channelId)).limit(1)
  if (!row) throw new ChannelNotFoundError(channelId)
  return toChannel(row)
}

export async function getChannelBySlug(db: Database, slug: string): Promise<Channel | undefined> {
  const [row] = await db.select().from(channels).where(eq(channels.slug, slug)).limit(1)
  return row ? toChannel(row) : undefined
}

/** Oldest first, so the first channel leads the switcher. Archived ones only on request. */
export async function listChannels(
  db: Database,
  options: { includeArchived?: boolean } = {},
): Promise<Channel[]> {
  const rows = await db
    .select()
    .from(channels)
    .where(options.includeArchived ? undefined : isNull(channels.archivedAt))
    .orderBy(asc(channels.createdAt), asc(channels.id))
  return rows.map(toChannel)
}

/** Whether a driver error is the unique violation on `channels.slug`. */
function isSlugTaken(error: unknown): boolean {
  // Drizzle wraps the driver's error; the violation sits in the cause.
  for (const candidate of [error, error instanceof Error ? error.cause : undefined]) {
    const pg = candidate as { code?: string; constraint_name?: string } | undefined
    if (pg?.code === '23505' && pg.constraint_name === 'channels_slug_key') return true
  }
  return false
}

/**
 * Insert a channel. The slug's unique constraint covers archived channels
 * too, so an address that ever named a channel never names another.
 */
export async function createChannel(
  db: Database,
  input: {
    name: string
    handle: string | null
    slug: string
    settings: Settings
    bible: ChannelBible
  },
): Promise<Channel> {
  try {
    const [row] = await db
      .insert(channels)
      .values({
        name: input.name,
        handle: input.handle,
        slug: input.slug,
        settings: input.settings,
        bible: input.bible,
      })
      .returning()
    return toChannel(row!)
  } catch (error) {
    if (isSlugTaken(error)) throw new ChannelSlugTakenError(input.slug, { cause: error })
    throw error
  }
}

/** The name, handle and bible; the slug is fixed at creation. */
export async function updateChannel(
  db: Database,
  channelId: string,
  patch: { name?: string; handle?: string | null; bible?: ChannelBible },
): Promise<Channel> {
  const [row] = await db
    .update(channels)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.handle === undefined ? {} : { handle: patch.handle }),
      ...(patch.bible === undefined ? {} : { bible: patch.bible }),
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId))
    .returning()
  if (!row) throw new ChannelNotFoundError(channelId)
  return toChannel(row)
}

/** Archive, never delete. Archiving twice keeps the first date. */
export async function archiveChannel(db: Database, channelId: string): Promise<Channel> {
  const [row] = await db
    .update(channels)
    .set({ archivedAt: sql`coalesce(${channels.archivedAt}, now())`, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
    .returning()
  if (!row) throw new ChannelNotFoundError(channelId)
  return toChannel(row)
}

/** The channel's own settings. Prices and the budget are the workspace's, read through `getWorkspace`. */
export async function getChannelSettings(db: Database, channelId: string): Promise<Settings> {
  const [row] = await db
    .select({ settings: channels.settings })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
  if (!row) throw new ChannelNotFoundError(channelId)
  return normaliseSettings(row.settings)
}

/**
 * Apply a validated patch to one channel's settings. Read-merge-write, so
 * the result passes `SettingsSchema` before it is stored, exactly as the
 * single settings row did.
 */
export async function updateChannelSettings(
  db: Database,
  channelId: string,
  patch: SettingsPatch,
): Promise<Settings> {
  const [row] = await db
    .select({ settings: channels.settings })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1)
  if (!row) throw new ChannelNotFoundError(channelId)
  const next = mergeSettings(normaliseSettings(row.settings), patch)
  await db
    .update(channels)
    .set({ settings: next, updatedAt: new Date() })
    .where(eq(channels.id, channelId))
  return next
}

/** The channel a project belongs to, with what a pipeline step reads from it. */
export async function channelForProject(
  db: Database,
  projectId: string,
): Promise<{ channelId: string; slug: string; settings: Settings; bible: ChannelBible }> {
  const [row] = await db
    .select({ channel: channels })
    .from(projects)
    .innerJoin(channels, eq(channels.id, projects.channelId))
    .where(eq(projects.id, projectId))
    .limit(1)
  if (!row) throw new ProjectNotFoundError(projectId)

  const channel = toChannel(row.channel)
  return {
    channelId: channel.id,
    slug: channel.slug,
    settings: channel.settings,
    bible: channel.bible,
  }
}

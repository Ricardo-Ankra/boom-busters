import { DEFAULT_WORKSPACE_SETTINGS, WorkspaceSettingsSchema } from '@boom-busters/schemas'
import type { WorkspaceSettings, WorkspaceSettingsPatch } from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import type { Database } from './client'
import { workspace } from './schema'
import { mergeWorkspaceSettings } from './settings-merge'

/**
 * The workspace row (multi-channel design, section 4.1): what belongs to the
 * owner rather than to a channel. Model price overrides and the one monthly
 * budget every channel spends against, plus the channel the console opens on.
 *
 * Exactly one row. Like the settings row before it, it is created from
 * defaults on first read, so no caller has a "not configured yet" branch.
 */

const WORKSPACE_ID = 'singleton' as const

export async function getWorkspace(
  db: Database,
): Promise<{ settings: WorkspaceSettings; defaultChannelId: string | null }> {
  const read = async () => {
    const [row] = await db.select().from(workspace).where(eq(workspace.id, WORKSPACE_ID)).limit(1)
    return row
  }

  let row = await read()
  if (!row) {
    await db
      .insert(workspace)
      .values({ id: WORKSPACE_ID, value: DEFAULT_WORKSPACE_SETTINGS })
      .onConflictDoNothing()
    row = await read()
  }

  return {
    settings: WorkspaceSettingsSchema.parse(row?.value ?? DEFAULT_WORKSPACE_SETTINGS),
    defaultChannelId: row?.defaultChannelId ?? null,
  }
}

/** Read-merge-write, so the stored value always passes `WorkspaceSettingsSchema`. */
export async function updateWorkspace(
  db: Database,
  patch: WorkspaceSettingsPatch,
): Promise<WorkspaceSettings> {
  const next = mergeWorkspaceSettings((await getWorkspace(db)).settings, patch)
  await db
    .update(workspace)
    .set({ value: next, updatedAt: new Date() })
    .where(eq(workspace.id, WORKSPACE_ID))
  return next
}

/** The channel `/` lands on. The foreign key refuses an id that names no channel. */
export async function setDefaultChannel(db: Database, channelId: string): Promise<void> {
  await getWorkspace(db)
  await db
    .update(workspace)
    .set({ defaultChannelId: channelId, updatedAt: new Date() })
    .where(eq(workspace.id, WORKSPACE_ID))
}

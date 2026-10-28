import { getWorkspace, listActiveRuns, listActivity, listChannels } from '@boom-busters/db'
import type { Channel } from '@boom-busters/db'
import { monthTotalUsd } from '@boom-busters/cost'
import { effectiveCeilingUsd } from '@boom-busters/schemas'
import 'server-only'
import type { SwitcherEntry } from '@/components/channel-switcher'
import { db } from './db'
import { needsYouCount } from './needs-you-count'

/**
 * What the console shell shows around every screen of a channel: the top
 * bar's live readouts and the Channel switcher's entries. Both channel layouts
 * (`/c/[slug]` and `/projects/[id]`) load it, so the two render one shell.
 */
export async function loadShellData(channel: Channel) {
  const [monthSpendUsd, activeRuns, activity, workspace, all] = await Promise.all([
    // Global: the one ceiling is a workspace total.
    monthTotalUsd(db, new Date()),
    listActiveRuns(db, channel.id),
    listActivity(db, { channelId: channel.id, limit: 60 }),
    // The one ceiling lives on the workspace row.
    getWorkspace(db),
    listChannels(db),
  ])

  // The viewed channel stays listed even when archived, so the switcher can name it.
  const listed = all.some((entry) => entry.id === channel.id) ? all : [...all, channel]
  const channels: SwitcherEntry[] = await Promise.all(
    listed.map(async (entry) => ({
      id: entry.id,
      slug: entry.slug,
      name: entry.name,
      needsYou: await needsYouCount(db, entry.id),
    })),
  )

  return {
    channel: {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      archivedAt: channel.archivedAt,
    },
    channels,
    monthSpendUsd,
    ceilingUsd: effectiveCeilingUsd(workspace.settings.budgets, new Date()),
    activeRuns,
    activity,
  }
}

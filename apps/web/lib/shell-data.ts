import { getSettings, listActiveRuns, listActivity, listChannels } from '@boom-busters/db'
import type { Channel } from '@boom-busters/db'
import { monthTotalUsd } from '@boom-busters/cost'
import { effectiveCeilingUsd } from '@boom-busters/schemas'
import 'server-only'
import type { SwitcherEntry } from '@/components/channel-switcher'
import { db } from './db'

/**
 * What the console shell shows around every screen of a channel: the top
 * bar's live readouts and the Channel switcher's entries. Both channel layouts
 * (`/c/[slug]` and `/projects/[id]`) load it, so the two render one shell.
 */
export async function loadShellData(channel: Channel) {
  const [monthSpendUsd, activeRuns, activity, settings, all] = await Promise.all([
    monthTotalUsd(db, new Date()),
    listActiveRuns(db),
    listActivity(db, { limit: 60 }),
    // Transitional: the workspace budgets ride on this wrapper until Task 9.
    getSettings(db),
    listChannels(db),
  ])

  // The viewed channel stays listed even when archived, so the switcher can name it.
  const listed = all.some((entry) => entry.id === channel.id) ? all : [...all, channel]
  // Per-channel needs-you counts arrive with Task 11.
  const channels: SwitcherEntry[] = listed.map((entry) => ({
    id: entry.id,
    slug: entry.slug,
    name: entry.name,
    needsYou: 0,
  }))

  return {
    channel: {
      id: channel.id,
      slug: channel.slug,
      name: channel.name,
      archivedAt: channel.archivedAt,
    },
    channels,
    monthSpendUsd,
    ceilingUsd: effectiveCeilingUsd(settings.budgets, new Date()),
    activeRuns,
    activity,
  }
}

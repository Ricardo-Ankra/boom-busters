import type { ActiveRun, ActivityEntry } from '@boom-busters/db'
import { AppRail } from '@/components/app-rail'
import { ChannelSlugProvider } from '@/components/channel-slug'
import type { SwitcherEntry } from '@/components/channel-switcher'
import { MobileNav } from '@/components/mobile-nav'
import { TopBar } from '@/components/top-bar'

/**
 * The console shell (build spec section 11.2) for one channel: rail headed by
 * the Channel switcher, top bar (which carries the switcher on phones, where
 * the rail is hidden), and the mobile bar. Pipeline screens use the full
 * width; only settings and text screens take a max width, applied per screen.
 *
 * The top bar's two live readouts are queried by the layouts that render this
 * rather than in each page, so every screen shows the same numbers.
 */
export function ConsoleShell({
  channel,
  channels,
  monthSpendUsd,
  ceilingUsd,
  activeRuns,
  activity,
  children,
}: {
  channel: { id: string; slug: string; name: string; archivedAt: Date | null }
  channels: SwitcherEntry[]
  monthSpendUsd: number
  /** `effectiveCeilingUsd`: the configured ceiling plus this month's overage. */
  ceilingUsd: number
  activeRuns: ActiveRun[]
  activity: ActivityEntry[]
  children: React.ReactNode
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-background)]">
      <div className="hidden md:flex">
        <AppRail slug={channel.slug} channels={channels} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          monthSpendUsd={monthSpendUsd}
          ceilingUsd={ceilingUsd}
          activeRuns={activeRuns}
          activity={activity}
          channels={channels}
          current={channel.slug}
        />
        {channel.archivedAt ? (
          <p className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-text-secondary)]">
            This channel is archived. Its history stays readable.
          </p>
        ) : null}
        {/* Bottom padding below md clears the fixed mobile bar. */}
        <main className="flex-1 overflow-y-auto p-3 pb-20 md:p-4">
          <ChannelSlugProvider slug={channel.slug}>{children}</ChannelSlugProvider>
        </main>
      </div>

      <MobileNav slug={channel.slug} />
    </div>
  )
}

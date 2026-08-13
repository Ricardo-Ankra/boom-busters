import { listActiveRuns, listActivity } from '@boom-busters/db'
import { monthTotalUsd } from '@boom-busters/cost'
import { AppRail } from '@/components/app-rail'
import { TopBar } from '@/components/top-bar'
import { db } from '@/lib/db'

/**
 * The console shell (build spec section 11.2). Pipeline screens use the full
 * width; only settings and text screens take a max width, applied per screen.
 *
 * The top bar's two live readouts are queried here rather than in each page,
 * so every screen shows the same numbers.
 */
export const dynamic = 'force-dynamic'

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [monthSpendUsd, activeRuns, activity] = await Promise.all([
    monthTotalUsd(db, new Date()),
    listActiveRuns(db),
    listActivity(db, { limit: 60 }),
  ])

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-background)]">
      <div className="hidden md:flex">
        <AppRail />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar monthSpendUsd={monthSpendUsd} activeRuns={activeRuns} activity={activity} />
        <main className="flex-1 overflow-y-auto p-3 md:p-4">{children}</main>
      </div>
    </div>
  )
}

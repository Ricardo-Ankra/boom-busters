import { AppRail } from '@/components/app-rail'
import { TopBar } from '@/components/top-bar'

/**
 * The console shell (build spec section 11.2). Pipeline screens use the full
 * width; only settings and text screens take a max width, applied per screen.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-background)]">
      <div className="hidden md:flex">
        <AppRail />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* M2 wires the real month spend from the cost ledger. */}
        <TopBar monthSpendUsd={null} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}

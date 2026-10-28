/**
 * The console group. Each channel's shell lives in its own layout
 * (`c/[slug]/layout.tsx`, `projects/[id]/layout.tsx`), so the readouts follow
 * the channel on screen.
 */
export const dynamic = 'force-dynamic'

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return children
}

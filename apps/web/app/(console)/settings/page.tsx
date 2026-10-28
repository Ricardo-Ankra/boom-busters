import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/**
 * Settings moved under the channel: `/c/<slug>/settings`, with `?tab=` kept.
 * Task 9 replaces this address with the workspace page.
 */
export default function SettingsRedirect({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('/settings', searchParams)
}

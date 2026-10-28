import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/** The Calendar moved under the channel: `/c/<slug>/calendar`. */
export default function CalendarRedirect({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('/calendar', searchParams)
}

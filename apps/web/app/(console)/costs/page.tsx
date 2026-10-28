import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/** Costs moved under the channel: `/c/<slug>/costs`. */
export default function CostsRedirect({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('/costs', searchParams)
}

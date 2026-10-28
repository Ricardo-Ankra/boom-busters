import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/** The Case Library moved under the channel: `/c/<slug>/cases`. */
export default function CasesRedirect({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('/cases', searchParams)
}

import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/** `/` lands on the channel last used (or the default one). */
export default function RootPage({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('', searchParams)
}

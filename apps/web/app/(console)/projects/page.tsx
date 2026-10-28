import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'

export const dynamic = 'force-dynamic'

/** The Projects list moved under the channel: `/c/<slug>/projects`. */
export default function ProjectsRedirect({ searchParams }: { searchParams: SearchParams }) {
  return redirectToLandingChannel('/projects', searchParams)
}

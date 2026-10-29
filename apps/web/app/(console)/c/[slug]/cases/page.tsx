import { listCaseNotices, listCases } from '@boom-busters/db'
import type { CaseSort } from '@boom-busters/db'
import { EXAMPLE_SLOT_IDS, isBibleComplete } from '@boom-busters/schemas'
import { CaseLibrary } from './case-library'
import { channelFromSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Case Library · Boom-Busters' }

const SORTS = ['priority', 'category', 'status', 'newest'] as const

function readSort(value: string | undefined): CaseSort {
  return SORTS.includes(value as CaseSort) ? (value as CaseSort) : 'priority'
}

/**
 * The Case Library (build spec section 11.3): a sortable table plus a
 * `Suggest cases` button that lands proposals as draft rows for triage, each
 * carrying visible `Accept` and `Dismiss` buttons.
 *
 * Sorting is a URL parameter rather than client state so a sorted view can be
 * linked to and survives the refresh that follows every action.
 */
export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string }>
}) {
  const [{ slug }, { sort }] = await Promise.all([params, searchParams])
  const active = readSort(sort)
  const channel = await channelFromSlug(slug)

  const cases = await listCases(db, channel.id, { sort: active })
  // Each case's notices (decision 293): what a suggestion's repair trimmed, on its row.
  const notices = await listCaseNotices(
    db,
    cases.map((item) => item.id),
  )

  return (
    <CaseLibrary
      slug={slug}
      channelId={channel.id}
      cases={cases}
      sort={active}
      notices={notices}
      bibleComplete={isBibleComplete(channel.bible, EXAMPLE_SLOT_IDS)}
      archived={channel.archivedAt !== null}
    />
  )
}

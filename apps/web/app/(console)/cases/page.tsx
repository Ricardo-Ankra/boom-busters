import { listCaseNotices, listCases } from '@boom-busters/db'
import type { CaseSort } from '@boom-busters/db'
import { CaseLibrary } from './case-library'
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
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>
}) {
  const { sort } = await searchParams
  const active = readSort(sort)

  const cases = await listCases(db, { sort: active })
  // Each case's notices (decision 293): what a suggestion's repair trimmed, on its row.
  const notices = await listCaseNotices(
    db,
    cases.map((item) => item.id),
  )

  return <CaseLibrary cases={cases} sort={active} notices={notices} />
}

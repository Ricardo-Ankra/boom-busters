import {
  channelResearchThresholds,
  countedVideosForChannel,
  latestOutcomeByProject,
  listResearchTuning,
  listCaseNotices,
  listCases,
  listProjects,
  suggestionDismissals,
} from '@boom-busters/db'
import type { CaseSort } from '@boom-busters/db'
import { EXAMPLE_SLOT_IDS, isBibleComplete } from '@boom-busters/schemas'
import { CaseLibrary } from './case-library'
import type { CaseSearchOutcome } from './case-panel'
import { resolveSelected } from './case-progress'
import { buildTrackRecordData } from './track-record-data'
import { channelFromSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Case Library · Boom-Busters' }

const SORTS = ['priority', 'category', 'status', 'newest'] as const

function readSort(value: string | undefined): CaseSort {
  return SORTS.includes(value as CaseSort) ? (value as CaseSort) : 'newest'
}

/**
 * The Case Library (build spec section 11.3): a sortable list beside the open
 * case's panel, with a triage group for rows proposed earlier as drafts, each
 * carrying visible `Accept` and `Dismiss` buttons.
 *
 * Sorting and the open case are URL parameters rather than client state so a
 * view can be linked to and survives the refresh that follows every action.
 */
export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string; case?: string | string[] }>
}) {
  const [{ slug }, { sort, case: caseParam }] = await Promise.all([params, searchParams])
  const active = readSort(sort)
  const channel = await channelFromSlug(slug)

  const cases = await listCases(db, channel.id, { sort: active })
  // Each case's notices (decision 293): what a suggestion's repair trimmed, on its row.
  // The open case is the URL's when it names one of these cases, else the first backlog case.
  const { selectedId, explicit } = resolveSelected(
    cases,
    typeof caseParam === 'string' ? caseParam : undefined,
  )
  const notices = await listCaseNotices(
    db,
    cases.map((item) => item.id),
  )

  // A published case shows its latest search report: the highest checkpoint among its projects.
  const [outcomes, projects] = await Promise.all([
    latestOutcomeByProject(db, channel.id),
    listProjects(db, channel.id),
  ])
  const searchOutcomes: Record<string, CaseSearchOutcome> = {}
  for (const project of projects) {
    const found = outcomes.get(project.id)
    if (!found) continue
    const kept = searchOutcomes[project.caseId]
    if (!kept || found.checkpoint > kept.checkpoint) {
      searchOutcomes[project.caseId] = { projectId: project.id, ...found }
    }
  }

  const [thresholds, counted, dismissals, tuning] = await Promise.all([
    channelResearchThresholds(db, channel.id),
    countedVideosForChannel(db, channel.id),
    suggestionDismissals(db, channel.id),
    listResearchTuning(db, channel.id),
  ])
  const trackRecord = buildTrackRecordData({
    videos: counted,
    current: thresholds,
    dismissals,
    applied: tuning.flatMap((row) =>
      row.key in thresholds
        ? [
            {
              key: row.key as keyof typeof thresholds,
              value: row.value,
              previous: row.previous,
              appliedAt: row.appliedAt.toISOString(),
              evidence: row.evidence,
            },
          ]
        : [],
    ),
  })

  return (
    <CaseLibrary
      slug={slug}
      channelId={channel.id}
      categories={channel.bible.caseCategories}
      formats={channel.bible.formats}
      cases={cases}
      sort={active}
      selectedId={selectedId}
      explicit={explicit}
      notices={notices}
      searchOutcomes={searchOutcomes}
      thresholds={thresholds}
      trackRecord={trackRecord}
      bibleComplete={isBibleComplete(channel.bible, EXAMPLE_SLOT_IDS)}
      archived={channel.archivedAt !== null}
    />
  )
}

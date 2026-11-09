import {
  COUNTED_OUTCOMES,
  SearchReportSchema,
  StoredSearchBriefSchema,
  frozenVerdictFor,
  type Checkpoint,
  type CountedVideo,
  type SearchOutcome,
  type SearchReport,
} from '@boom-busters/schemas'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { cases, projects, searchRankChecks, searchReports, searchTermDismissals } from './schema'
import type { SearchRankCheckRow, SearchReportRow } from './schema'

/**
 * Frozen per-video search reports, manual rank checks and dismissed terms.
 *
 * A report row is pending until the runner has everything it needs, then it
 * is frozen once and never touched again: the freeze only writes while the
 * row is pending, so a replayed step cannot overwrite a report.
 */

export async function pendingReport(
  db: Database,
  input: { channelId: string; projectId: string; videoId: string; checkpoint: number },
): Promise<SearchReportRow> {
  await db
    .insert(searchReports)
    .values({
      channelId: input.channelId,
      projectId: input.projectId,
      videoId: input.videoId,
      checkpoint: input.checkpoint,
    })
    .onConflictDoNothing({ target: [searchReports.videoId, searchReports.checkpoint] })
  const [row] = await db
    .select()
    .from(searchReports)
    .where(
      and(eq(searchReports.videoId, input.videoId), eq(searchReports.checkpoint, input.checkpoint)),
    )
  if (!row) throw new Error('search report row missing after insert')
  return row
}

export async function recordReportDeferral(
  db: Database,
  id: string,
  kind: 'model' | 'rank',
): Promise<SearchReportRow> {
  const set =
    kind === 'model'
      ? { modelAttempts: sql`${searchReports.modelAttempts} + 1` }
      : { rankAttempts: sql`${searchReports.rankAttempts} + 1` }
  const [row] = await db
    .update(searchReports)
    .set({ ...set, updatedAt: sql`now()` })
    .where(eq(searchReports.id, id))
    .returning()
  if (!row) throw new Error(`search report ${id} not found`)
  return row
}

/** Freezes a pending row. A row that is already frozen is left as it was. */
export async function freezeSearchReport(
  db: Database,
  id: string,
  report: SearchReport,
): Promise<void> {
  await db
    .update(searchReports)
    .set({ state: 'frozen', report, frozenAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(searchReports.id, id), eq(searchReports.state, 'pending')))
}

export async function frozenReportsForChannel(
  db: Database,
  channelId: string,
  checkpoint: Checkpoint,
): Promise<{ videoId: string; projectId: string; report: SearchReport }[]> {
  const rows = await db
    .select()
    .from(searchReports)
    .where(
      and(
        eq(searchReports.channelId, channelId),
        eq(searchReports.checkpoint, checkpoint),
        eq(searchReports.state, 'frozen'),
      ),
    )
    .orderBy(searchReports.createdAt)
  const out: { videoId: string; projectId: string; report: SearchReport }[] = []
  for (const row of rows) {
    if (row.report === null) continue
    out.push({
      videoId: row.videoId,
      projectId: row.projectId,
      report: SearchReportSchema.parse(row.report),
    })
  }
  return out
}

/**
 * The day-28 frozen reports the learning counts: joined to their project and
 * case, each with its frozen verdict (recomputed when none was stored), the
 * target's estimated searches and its intent and topic. Reports whose outcome
 * is not a counted one, and projects with no verdict, are left out.
 */
export async function countedVideosForChannel(
  db: Database,
  channelId: string,
): Promise<(CountedVideo & { targetIntent?: string; targetTopic?: string })[]> {
  const rows = await db
    .select({
      projectId: projects.id,
      title: projects.title,
      searchBrief: projects.searchBrief,
      researchVerdict: projects.researchVerdict,
      category: cases.category,
      report: searchReports.report,
    })
    .from(searchReports)
    .innerJoin(projects, eq(projects.id, searchReports.projectId))
    .innerJoin(cases, eq(cases.id, projects.caseId))
    .where(
      and(
        eq(searchReports.channelId, channelId),
        eq(projects.channelId, channelId),
        eq(searchReports.checkpoint, 28),
        eq(searchReports.state, 'frozen'),
      ),
    )
    .orderBy(searchReports.createdAt)
  const out: (CountedVideo & { targetIntent?: string; targetTopic?: string })[] = []
  for (const row of rows) {
    if (row.report === null) continue
    const report = SearchReportSchema.parse(row.report)
    if (!COUNTED_OUTCOMES.includes(report.outcome)) continue
    const parsedBrief = StoredSearchBriefSchema.nullable().safeParse(row.searchBrief ?? null)
    const brief = parsedBrief.success ? parsedBrief.data : null
    const verdict = frozenVerdictFor({
      stored: row.researchVerdict,
      brief,
      caseCategory: row.category,
    })
    if (verdict === null) continue
    const target = brief?.targetKeyword ?? null
    out.push({
      projectId: row.projectId,
      title: row.title,
      verdict,
      report,
      targetSearches: target?.estimatedMonthlySearch ?? null,
      ...(target?.intent ? { targetIntent: target.intent } : {}),
      ...(target?.topic ? { targetTopic: target.topic } : {}),
    })
  }
  return out
}

export async function searchReportsForVideo(
  db: Database,
  videoId: string,
): Promise<SearchReportRow[]> {
  const rows = await db
    .select()
    .from(searchReports)
    .where(eq(searchReports.videoId, videoId))
    .orderBy(searchReports.checkpoint)
  return rows.map((row) =>
    row.report === null ? row : { ...row, report: SearchReportSchema.parse(row.report) },
  )
}

/** The outcome of the highest frozen checkpoint, per project. */
export async function latestOutcomeByProject(
  db: Database,
  channelId: string,
): Promise<Map<string, { checkpoint: Checkpoint; outcome: SearchOutcome }>> {
  const rows = await db
    .select()
    .from(searchReports)
    .where(and(eq(searchReports.channelId, channelId), eq(searchReports.state, 'frozen')))
    .orderBy(searchReports.checkpoint)
  const out = new Map<string, { checkpoint: Checkpoint; outcome: SearchOutcome }>()
  for (const row of rows) {
    if (row.report === null) continue
    const report = SearchReportSchema.parse(row.report)
    // Ascending by checkpoint, so a later row for the project is the higher one.
    out.set(row.projectId, { checkpoint: report.checkpoint, outcome: report.outcome })
  }
  return out
}

export async function addRankCheck(
  db: Database,
  input: {
    channelId: string
    videoId: string
    keyword: string
    /** Null means "not in the top 10". */
    position: number | null
    checkedAt?: Date
  },
): Promise<SearchRankCheckRow> {
  const [row] = await db
    .insert(searchRankChecks)
    .values({
      channelId: input.channelId,
      videoId: input.videoId,
      keyword: input.keyword,
      position: input.position,
      ...(input.checkedAt ? { checkedAt: input.checkedAt } : {}),
    })
    .returning()
  if (!row) throw new Error('rank check insert returned no row')
  return row
}

/** Newest first. */
export async function rankChecksForVideo(
  db: Database,
  videoId: string,
): Promise<SearchRankCheckRow[]> {
  return db
    .select()
    .from(searchRankChecks)
    .where(eq(searchRankChecks.videoId, videoId))
    .orderBy(desc(searchRankChecks.checkedAt))
}

export async function dismissSearchTerm(
  db: Database,
  channelId: string,
  termKey: string,
): Promise<void> {
  await db
    .insert(searchTermDismissals)
    .values({ channelId, termKey })
    .onConflictDoNothing({ target: [searchTermDismissals.channelId, searchTermDismissals.termKey] })
}

export async function dismissedTermKeys(db: Database, channelId: string): Promise<Set<string>> {
  const rows = await db
    .select({ termKey: searchTermDismissals.termKey })
    .from(searchTermDismissals)
    .where(eq(searchTermDismissals.channelId, channelId))
  return new Set(rows.map((r) => r.termKey))
}

/** Test-only: empty the three tables. */
export async function truncateSearchReports(db: Database): Promise<void> {
  await db.delete(searchReports)
  await db.delete(searchRankChecks)
  await db.delete(searchTermDismissals)
}

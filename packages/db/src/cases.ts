import { and, asc, desc, eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { Database } from './client'
import { cases, projects } from './schema'
import type { CaseCategory, CaseRow, CaseStatus } from './schema'

/**
 * Case Library queries (build spec section 11.3).
 *
 * The library is the front of the pipeline: every project starts as a case,
 * and a case's `status` is the whole of its lifecycle — `idea` (proposed, not
 * yet triaged), `shortlisted` (accepted, eligible to become a project),
 * `in_production`, `published`, `retired`.
 *
 * "Dismiss" therefore does not delete. A dismissed case becomes `retired` and
 * stays in the table, because the same case will be suggested again next month
 * and the reason it was rejected the first time is worth keeping.
 */

export const CASE_SORTS = ['priority', 'category', 'status', 'newest'] as const
export type CaseSort = (typeof CASE_SORTS)[number]

export interface CaseSummary {
  id: string
  title: string
  category: CaseCategory
  angle: string | null
  demandNotes: string | null
  competitorLinks: { url: string; note?: string }[]
  priorityScore: number
  status: CaseStatus
  /** How many projects have been started from this case. */
  projectCount: number
  createdAt: Date
  updatedAt: Date
}

const summaryColumns = {
  id: cases.id,
  title: cases.title,
  category: cases.category,
  angle: cases.angle,
  demandNotes: cases.demandNotes,
  competitorLinks: cases.competitorLinks,
  priorityScore: cases.priorityScore,
  status: cases.status,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
  projectCount: sql<number>`count(${projects.id})::int`,
}

function orderFor(sort: CaseSort) {
  switch (sort) {
    case 'category':
      return [asc(cases.category), desc(cases.priorityScore)]
    case 'status':
      return [asc(cases.status), desc(cases.priorityScore)]
    case 'newest':
      return [desc(cases.createdAt)]
    case 'priority':
    default:
      // Ties broken by title so the table has a stable order between renders;
      // a list that reshuffles under the cursor is a list you cannot click.
      return [desc(cases.priorityScore), asc(cases.title)]
  }
}

export async function listCases(
  db: Database,
  options: { sort?: CaseSort; status?: readonly CaseStatus[] } = {},
): Promise<CaseSummary[]> {
  const where = options.status?.length ? inArray(cases.status, [...options.status]) : undefined

  const rows = await db
    .select(summaryColumns)
    .from(cases)
    .leftJoin(projects, eq(projects.caseId, cases.id))
    .where(where)
    .groupBy(cases.id)
    .orderBy(...orderFor(options.sort ?? 'priority'))

  return rows as CaseSummary[]
}

export async function getCase(db: Database, id: string): Promise<CaseSummary | undefined> {
  const [row] = await db
    .select(summaryColumns)
    .from(cases)
    .leftJoin(projects, eq(projects.caseId, cases.id))
    .where(eq(cases.id, id))
    .groupBy(cases.id)
    .limit(1)

  return row as CaseSummary | undefined
}

export interface CaseInput {
  title: string
  category: CaseCategory
  angle?: string | null
  demandNotes?: string | null
  competitorLinks?: { url: string; note?: string }[]
  priorityScore?: number
  status?: CaseStatus
}

export async function createCase(db: Database, input: CaseInput): Promise<CaseRow> {
  const [row] = await db
    .insert(cases)
    .values({
      title: input.title,
      category: input.category,
      angle: input.angle ?? null,
      demandNotes: input.demandNotes ?? null,
      competitorLinks: input.competitorLinks ?? [],
      priorityScore: input.priorityScore ?? 0,
      status: input.status ?? 'idea',
    })
    .returning()

  return row!
}

/**
 * Insert suggestions, skipping any whose title already exists.
 *
 * Suggestion runs overlap heavily — ask twice in a month and the same famous
 * collapses come back both times. Returning the count of skipped rows lets the
 * UI say "6 new, 4 already in your library" instead of silently producing
 * duplicates the human then has to dismiss one by one.
 */
export async function createSuggestedCases(
  db: Database,
  inputs: readonly CaseInput[],
): Promise<{ created: CaseRow[]; skippedTitles: string[] }> {
  if (inputs.length === 0) return { created: [], skippedTitles: [] }

  const existing = await db.select({ title: cases.title }).from(cases)
  const seen = new Set(existing.map((row) => row.title.trim().toLowerCase()))

  const created: CaseRow[] = []
  const skippedTitles: string[] = []

  for (const input of inputs) {
    const key = input.title.trim().toLowerCase()
    // Also guards duplicates *within* one batch, which a model will happily
    // produce when it phrases the same case two ways.
    if (seen.has(key)) {
      skippedTitles.push(input.title)
      continue
    }
    seen.add(key)
    created.push(await createCase(db, input))
  }

  return { created, skippedTitles }
}

export async function updateCase(
  db: Database,
  id: string,
  patch: Partial<CaseInput>,
): Promise<CaseRow | undefined> {
  const [row] = await db
    .update(cases)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(cases.id, id))
    .returning()

  return row
}

export async function setCaseStatus(
  db: Database,
  id: string,
  status: CaseStatus,
): Promise<CaseRow | undefined> {
  return updateCase(db, id, { status })
}

/**
 * Delete a case outright. Only offered for one that has never been produced —
 * removing a case with projects behind it would orphan the record of why they
 * exist, so the UI offers `retired` instead.
 */
export async function deleteCase(db: Database, id: string): Promise<boolean> {
  const [inUse] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.caseId, id))
    .limit(1)

  if (inUse) return false

  const deleted = await db.delete(cases).where(eq(cases.id, id)).returning({ id: cases.id })
  return deleted.length > 0
}

/** Cases eligible to start a project: shortlisted and not already running. */
export async function listProducibleCases(db: Database): Promise<CaseSummary[]> {
  return listCases(db, { status: ['shortlisted'] })
}

export async function truncateCases(db: Database): Promise<void> {
  await db.execute(sql`truncate table ${cases} restart identity cascade`)
}

/** Everything the suggestion prompt should avoid proposing again. */
export async function existingCaseTitles(db: Database): Promise<string[]> {
  const rows = await db.select({ title: cases.title }).from(cases).orderBy(asc(cases.title))
  return rows.map((row) => row.title)
}

/** Move a case into production when its first project starts. */
export async function markCaseInProduction(db: Database, id: string): Promise<void> {
  await db
    .update(cases)
    .set({ status: 'in_production', updatedAt: new Date() })
    .where(and(eq(cases.id, id), inArray(cases.status, ['idea', 'shortlisted'])))
}

/**
 * Delete every case except the ones named, and the projects that came from
 * them.
 *
 * The E2E suite adds cases and starts projects; without this the database
 * carries them into the next run and assertions that were exact ("this case
 * appears once") start matching two rows. Repeatability is the whole value of
 * a fixture, so it is restored here rather than worked around by loosening the
 * assertions.
 *
 * Projects go first because `projects.caseId` is `onDelete: 'restrict'` — the
 * database will not let a case that produced something be deleted out from
 * under it, which is the right rule for the app and simply means test cleanup
 * has to be explicit about what it is destroying.
 */
export async function deleteCasesExcept(db: Database, keepIds: readonly string[]): Promise<number> {
  const doomed = keepIds.length > 0 ? notInArray(cases.id, [...keepIds]) : undefined

  const targets = await db.select({ id: cases.id }).from(cases).where(doomed)
  if (targets.length === 0) return 0

  const ids = targets.map((row) => row.id)
  await db.delete(projects).where(inArray(projects.caseId, ids))

  const deleted = await db.delete(cases).where(inArray(cases.id, ids)).returning({ id: cases.id })
  return deleted.length
}

import {
  CASE_SEED_KEYWORDS_MAX,
  CaseResearchJobSchema,
  SearchBriefSchema,
  briefPhrases,
  phraseKey,
  RECOMMENDATION_REASON_MAX,
  StoredSearchBriefSchema,
  briefDemandNotes,
  classifySearchTerms,
  keywordHasFigure,
} from '@boom-busters/schemas'
import type {
  CaseResearchJob,
  FieldCheck,
  NicheJob,
  NicheTest,
  SearchBrief,
  SearchKeyword,
} from '@boom-busters/schemas'
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm'
import type { Database } from './client'
import { cases, projects } from './schema'
import type { CaseRow, CaseStatus } from './schema'

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
  category: string
  angle: string | null
  demandNotes: string | null
  competitorLinks: { url: string; note?: string }[]
  subject: string | null
  people: string[]
  sourceLinks: { url: string; note?: string }[]
  /** Phrases the research run measures as keywords beside what it finds (decision 467). */
  seedKeywords: string[]
  /** The VidIQ research brief for `subject`; null when none, or when the stored row does not parse. */
  searchBrief: SearchBrief | null
  /** The research run in flight or last finished; null when none, or when the stored row does not parse. */
  searchJob: CaseResearchJob | null
  /** The channel format this case is made as; null means the primary. */
  formatKey: string | null
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
  subject: cases.subject,
  people: cases.people,
  sourceLinks: cases.sourceLinks,
  seedKeywords: cases.seedKeywords,
  searchBrief: cases.searchBrief,
  searchJob: cases.searchJob,
  formatKey: cases.formatKey,
  priorityScore: cases.priorityScore,
  status: cases.status,
  createdAt: cases.createdAt,
  updatedAt: cases.updatedAt,
  projectCount: sql<number>`count(${projects.id})::int`,
}

/** Every read upgrades an old brief: titles and other languages leave the keywords. */
const storedBrief = StoredSearchBriefSchema.nullable().catch(null)
/** The brief as stored, not upgraded; only to tell whether the notes came from it. */
const rawStoredBrief = SearchBriefSchema.nullable().catch(null)
const storedJob = CaseResearchJobSchema.nullable().catch(null)

/**
 * The raw stored jsonb as the app's types. A row written before the columns
 * existed, or one that no longer parses, reads null rather than throwing.
 */
type SummaryRow = Omit<CaseSummary, 'searchBrief' | 'searchJob'> & {
  searchBrief: unknown
  searchJob: unknown
}
function toSummary(row: SummaryRow): CaseSummary {
  return {
    ...row,
    searchBrief: storedBrief.parse(row.searchBrief ?? null),
    searchJob: storedJob.parse(row.searchJob ?? null),
  }
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
  channelId: string,
  options: { sort?: CaseSort; status?: readonly CaseStatus[] } = {},
): Promise<CaseSummary[]> {
  const where = options.status?.length
    ? and(eq(cases.channelId, channelId), inArray(cases.status, [...options.status]))
    : eq(cases.channelId, channelId)

  const rows = await db
    .select(summaryColumns)
    .from(cases)
    .leftJoin(projects, eq(projects.caseId, cases.id))
    .where(where)
    .groupBy(cases.id)
    .orderBy(...orderFor(options.sort ?? 'priority'))

  return rows.map((row) => toSummary(row as SummaryRow))
}

export async function getCase(db: Database, id: string): Promise<CaseSummary | undefined> {
  const [row] = await db
    .select(summaryColumns)
    .from(cases)
    .leftJoin(projects, eq(projects.caseId, cases.id))
    .where(eq(cases.id, id))
    .groupBy(cases.id)
    .limit(1)

  return row ? toSummary(row as SummaryRow) : undefined
}

export interface CaseInput {
  channelId: string
  title: string
  category: string
  angle?: string | null
  demandNotes?: string | null
  competitorLinks?: { url: string; note?: string }[]
  subject?: string | null
  people?: string[]
  sourceLinks?: { url: string; note?: string }[]
  seedKeywords?: string[]
  priorityScore?: number
  status?: CaseStatus
}

export async function createCase(db: Database, input: CaseInput): Promise<CaseRow> {
  const [row] = await db
    .insert(cases)
    .values({
      channelId: input.channelId,
      title: input.title,
      category: input.category,
      angle: input.angle ?? null,
      demandNotes: input.demandNotes ?? null,
      competitorLinks: input.competitorLinks ?? [],
      subject: input.subject ?? null,
      people: input.people ?? [],
      sourceLinks: input.sourceLinks ?? [],
      seedKeywords: input.seedKeywords ?? [],
      priorityScore: input.priorityScore ?? 0,
      status: input.status ?? 'idea',
    })
    .returning()

  return row!
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

/** Whether another case in the channel already has this subject (trimmed, case-insensitive). */
export async function caseSubjectTaken(
  db: Database,
  channelId: string,
  subject: string,
  exceptId?: string,
): Promise<boolean> {
  const key = subject.trim().toLowerCase()
  if (key === '') return false
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(
      and(
        eq(cases.channelId, channelId),
        sql`lower(btrim(${cases.subject})) = ${key}`,
        exceptId === undefined ? undefined : ne(cases.id, exceptId),
      ),
    )
    .limit(1)
  return row !== undefined
}

type CaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Lock the case row for the rest of the transaction and read its brief and job.
 * `rawBrief` is the stored brief before the upgrade, so a writer can tell notes
 * written from the old target from notes the owner wrote.
 */
async function lockCaseResearch(
  tx: CaseTransaction,
  caseId: string,
): Promise<{
  brief: SearchBrief | null
  rawBrief: SearchBrief | null
  job: CaseResearchJob | null
}> {
  const [row] = await tx
    .select({ searchBrief: cases.searchBrief, searchJob: cases.searchJob })
    .from(cases)
    .where(eq(cases.id, caseId))
    .for('update')
  if (!row) throw new Error(`case ${caseId} not found`)
  return {
    brief: storedBrief.parse(row.searchBrief ?? null),
    rawBrief: rawStoredBrief.parse(row.searchBrief ?? null),
    job: storedJob.parse(row.searchJob ?? null),
  }
}

/**
 * Read the case's research job under a row lock, store what `update` returns
 * (null clears it) and hand it back. Two writers (a run's heartbeat and an
 * owner's Stop) never overwrite each other.
 */
export async function writeCaseResearchJob(
  db: Database,
  caseId: string,
  update: (job: CaseResearchJob | null) => CaseResearchJob | null,
): Promise<CaseResearchJob | null> {
  return db.transaction(async (tx) => {
    const { job } = await lockCaseResearch(tx, caseId)
    const next = update(job)
    await tx.update(cases).set({ searchJob: next }).where(eq(cases.id, caseId))
    return next
  })
}

/**
 * Save a finished brief and mark the job done, only while the job is still the
 * running job that started at `jobStartedAt`. A run that was stopped, failed or
 * superseded writes nothing and gets false.
 */
export async function saveCaseSearchBrief(
  db: Database,
  caseId: string,
  brief: SearchBrief,
  jobStartedAt: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const { job } = await lockCaseResearch(tx, caseId)
    // A failed or stopped job keeps its startedAt, so the state matters too.
    if (!job || job.startedAt !== jobStartedAt || job.state !== 'running') return false
    await tx
      .update(cases)
      .set({
        searchBrief: brief,
        searchJob: { ...job, state: 'done', current: null, error: null },
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId))
    return true
  })
}

/** What choosing an angle did to the target keyword; null when there was nothing to say. */
export type TargetChange = { to: string } | { keptBecause: string } | null

const keyOf = (term: string) => term.trim().toLowerCase()

/** The brief with a secondary keyword made the target; the old target joins the secondaries. */
function withTarget(brief: SearchBrief, chosen: SearchKeyword): SearchBrief {
  return {
    ...brief,
    targetKeyword: chosen,
    secondaryKeywords: [
      ...brief.secondaryKeywords.filter((k) => k !== chosen),
      ...(brief.targetKeyword ? [brief.targetKeyword] : []),
    ],
  }
}

/**
 * Whether an angle's keyword can become the target, and if not, why the target
 * stays. Eligible: a secondary keyword, of keyword kind, with no figure and a
 * fit that is not `off`.
 */
function targetForAngle(
  brief: SearchBrief,
  keyword: string,
): { eligible: SearchKeyword } | { keptBecause: string } | null {
  const wanted = keyOf(keyword)
  const target = brief.targetKeyword
  if (wanted === '' || !target || keyOf(target.keyword) === wanted) return null
  const stays = `so the target stays ${target.keyword}`
  const kind = classifySearchTerms(
    [
      target.keyword,
      ...brief.secondaryKeywords.map((k) => k.keyword),
      ...brief.searchedTitles.map((k) => k.keyword),
      ...brief.otherLanguages.map((k) => k.keyword),
      keyword,
    ],
    { language: brief.language },
  ).get(wanted)
  const secondary = brief.secondaryKeywords.find((k) => keyOf(k.keyword) === wanted)
  const offIntent = (brief.offIntent ?? []).some((k) => keyOf(k.keyword) === wanted)
  if (keywordHasFigure(keyword)) {
    return { keptBecause: `This angle's keyword has a figure, ${stays}` }
  }
  if (kind === 'title' || kind === 'other-language') {
    return { keptBecause: `This angle serves a searched title, ${stays}` }
  }
  if (secondary?.fit === 'off' || (offIntent && !secondary)) {
    return { keptBecause: `This angle's keyword does not fit this channel, ${stays}` }
  }
  return secondary ? { eligible: secondary } : null
}

/**
 * Settle the case's angle from its brief: one of the offered options, or the
 * owner's own words. Rewrites the demand notes from the brief. An option whose
 * keyword can be the target makes it the target; the result says what happened.
 */
export async function chooseCaseAngle(
  db: Database,
  caseId: string,
  choice: { option: number } | { own: string },
): Promise<{ summary: CaseSummary; targetChange: TargetChange }> {
  let targetChange: TargetChange = null
  await db.transaction(async (tx) => {
    const { brief } = await lockCaseResearch(tx, caseId)
    if (!brief) throw new Error('this case has no search brief to choose an angle from')
    let angle: string
    let chosenAngle: number | null
    let ownAngle: boolean
    let base = brief
    if ('option' in choice) {
      const option = brief.angleOptions[choice.option]
      if (!option) throw new Error(`angle option ${choice.option} does not exist`)
      angle = option.angle
      chosenAngle = choice.option
      ownAngle = false
      const verdict = targetForAngle(brief, option.keyword)
      if (verdict && 'eligible' in verdict) {
        base = withTarget(brief, verdict.eligible)
        targetChange = { to: verdict.eligible.keyword }
      } else if (verdict) {
        targetChange = verdict
      }
    } else {
      angle = choice.own.trim()
      if (angle === '') throw new Error('an angle of your own cannot be empty')
      chosenAngle = null
      ownAngle = true
    }
    const next: SearchBrief = { ...base, chosenAngle, ownAngle }
    await tx
      .update(cases)
      .set({
        angle,
        searchBrief: next,
        demandNotes: briefDemandNotes(next),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId))
  })
  const summary = await getCase(db, caseId)
  if (!summary) throw new Error(`case ${caseId} not found`)
  return { summary, targetChange }
}

/**
 * Whether the case's demand notes are still the brief's own line, before or
 * after the upgrade. Those follow the brief; notes the owner wrote or edited
 * by hand stay as they are.
 */
async function notesFollow(
  tx: CaseTransaction,
  caseId: string,
  rawBrief: SearchBrief | null,
  brief: SearchBrief,
): Promise<boolean> {
  const [row] = await tx
    .select({ demandNotes: cases.demandNotes })
    .from(cases)
    .where(eq(cases.id, caseId))
  const notes = row?.demandNotes
  if (notes === null || notes === undefined) return false
  return (
    notes === briefDemandNotes(brief) || (rawBrief !== null && notes === briefDemandNotes(rawBrief))
  )
}

/**
 * Save the model's rating of the brief's angle options: which it recommends and
 * why. Null, with nothing written, when the brief is gone or its options are no
 * longer the ones that were rated.
 */
export async function saveCaseAngleRating(
  db: Database,
  caseId: string,
  rating: { options: readonly string[]; recommended: number; reason: string },
): Promise<CaseSummary | null> {
  const saved = await db.transaction(async (tx) => {
    const { brief, rawBrief } = await lockCaseResearch(tx, caseId)
    if (!brief) return false
    const current = brief.angleOptions.map((o) => o.angle)
    if (
      current.length !== rating.options.length ||
      current.some((angle, i) => angle !== rating.options[i])
    ) {
      return false
    }
    if (
      !Number.isInteger(rating.recommended) ||
      rating.recommended < 0 ||
      rating.recommended >= current.length
    ) {
      return false
    }
    const next: SearchBrief = {
      ...brief,
      recommendedAngle: rating.recommended,
      recommendationReason: rating.reason.trim().slice(0, RECOMMENDATION_REASON_MAX).trim(),
    }
    // A brief that would not parse reads back as null, so it is never written.
    if (!SearchBriefSchema.safeParse(next).success) return false
    const followNotes = await notesFollow(tx, caseId, rawBrief, brief)
    await tx
      .update(cases)
      .set({
        searchBrief: next,
        ...(followNotes ? { demandNotes: briefDemandNotes(next) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId))
    return true
  })
  if (!saved) return null
  return (await getCase(db, caseId)) ?? null
}

/**
 * Make one of the brief's secondary keywords the target; the old target joins
 * the secondaries. A keyword with a figure is never the target.
 */
export async function setCaseTargetKeyword(
  db: Database,
  caseId: string,
  keyword: string,
): Promise<CaseSummary> {
  if (keywordHasFigure(keyword)) {
    throw new Error('a keyword with a figure cannot be the target keyword')
  }
  const wanted = keyword.trim().toLowerCase()
  await db.transaction(async (tx) => {
    const { brief, rawBrief } = await lockCaseResearch(tx, caseId)
    if (!brief) throw new Error('this case has no search brief')
    const terms = [
      ...(brief.targetKeyword ? [brief.targetKeyword.keyword] : []),
      ...brief.secondaryKeywords.map((k) => k.keyword),
      ...brief.searchedTitles.map((k) => k.keyword),
      ...brief.otherLanguages.map((k) => k.keyword),
      keyword,
    ]
    if (classifySearchTerms(terms).get(wanted) !== 'keyword') {
      throw new Error('a searched video title or another language cannot be the target keyword')
    }
    const chosen = brief.secondaryKeywords.find((k) => k.keyword.trim().toLowerCase() === wanted)
    if (!chosen) throw new Error(`"${keyword}" is not one of this brief's secondary keywords`)
    const next = withTarget(brief, chosen)
    const followNotes = await notesFollow(tx, caseId, rawBrief, brief)
    await tx
      .update(cases)
      .set({
        searchBrief: next,
        ...(followNotes ? { demandNotes: briefDemandNotes(next) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cases.id, caseId))
  })
  const updated = await getCase(db, caseId)
  if (!updated) throw new Error(`case ${caseId} not found`)
  return updated
}

/**
 * Save a brief with one evidence list changed, under the row lock. Null, with
 * nothing written, when there is no brief or the result would not parse (a
 * brief that does not parse reads back as null, so it is never written).
 */
async function saveEvidence(
  db: Database,
  caseId: string,
  change: (brief: SearchBrief) => SearchBrief,
): Promise<CaseSummary | null> {
  const saved = await db.transaction(async (tx) => {
    const { brief } = await lockCaseResearch(tx, caseId)
    if (!brief) return false
    const next = change(brief)
    if (!SearchBriefSchema.safeParse(next).success) return false
    await tx
      .update(cases)
      .set({ searchBrief: next, updatedAt: new Date() })
      .where(eq(cases.id, caseId))
    return true
  })
  if (!saved) return null
  return (await getCase(db, caseId)) ?? null
}

const FIELD_CHECKS_MAX = 4
const NICHE_TESTS_MAX = 3

/** Save a field check, replacing one for the same keyword; at the cap the oldest check goes. */
export async function saveCaseFieldCheck(
  db: Database,
  caseId: string,
  check: FieldCheck,
): Promise<CaseSummary | null> {
  return saveEvidence(db, caseId, (brief) => {
    const kept = (brief.fieldChecks ?? []).filter((c) => keyOf(c.keyword) !== keyOf(check.keyword))
    if (kept.length >= FIELD_CHECKS_MAX) {
      const oldest = kept.reduce((a, b) => (b.checkedAt < a.checkedAt ? b : a))
      kept.splice(kept.indexOf(oldest), 1)
    }
    return { ...brief, fieldChecks: [...kept, check] }
  })
}

export type AddOwnerKeywordResult = 'added' | 'present' | 'full' | 'no-brief'

/**
 * `Add keyword` (decision 467): put one measured phrase on the brief's other
 * keywords, marked as the owner's, and keep it as a seed so the next run
 * measures it again. Under the row lock, so a run saving its brief meanwhile
 * is never overwritten. `present` when the brief already shows the phrase,
 * `full` when the owner already has `CASE_SEED_KEYWORDS_MAX` of their own on it.
 */
export async function addCaseOwnerKeyword(
  db: Database,
  caseId: string,
  row: SearchKeyword,
): Promise<AddOwnerKeywordResult> {
  return db.transaction(async (tx) => {
    const { brief } = await lockCaseResearch(tx, caseId)
    if (!brief) return 'no-brief'
    const key = phraseKey(row.keyword)
    if (briefPhrases(brief).has(key)) return 'present'
    const owned = brief.secondaryKeywords.filter((k) => k.owner).length
    if (owned >= CASE_SEED_KEYWORDS_MAX) return 'full'
    const next: SearchBrief = {
      ...brief,
      secondaryKeywords: [...brief.secondaryKeywords, { ...row, owner: true }],
    }
    if (!SearchBriefSchema.safeParse(next).success) return 'full'
    const [stored] = await tx
      .select({ seedKeywords: cases.seedKeywords })
      .from(cases)
      .where(eq(cases.id, caseId))
    const seeds = stored?.seedKeywords ?? []
    const nextSeeds =
      seeds.some((seed) => phraseKey(seed) === key) || seeds.length >= CASE_SEED_KEYWORDS_MAX
        ? seeds
        : [...seeds, row.keyword]
    await tx
      .update(cases)
      .set({ searchBrief: next, seedKeywords: nextSeeds, updatedAt: new Date() })
      .where(eq(cases.id, caseId))
    return 'added'
  })
}

/** Save a niche test, replacing one for the same angle; at the cap the first test goes. */
export async function saveCaseNicheTest(
  db: Database,
  caseId: string,
  test: NicheTest,
): Promise<CaseSummary | null> {
  return saveEvidence(db, caseId, (brief) => {
    const kept = (brief.nicheTests ?? []).filter((t) => t.angle !== test.angle)
    const jobs = (brief.nicheJobs ?? []).filter((j) => j.angle !== test.angle)
    return {
      ...brief,
      nicheTests: [...(kept.length >= NICHE_TESTS_MAX ? kept.slice(1) : kept), test],
      ...(brief.nicheJobs === undefined ? {} : { nicheJobs: jobs }),
    }
  })
}

/**
 * Keep a paid niche job that had not finished, replacing one for the same
 * angle; at the cap the oldest goes. `Test this angle` collects it for free.
 */
export async function saveCaseNicheJob(
  db: Database,
  caseId: string,
  job: NicheJob,
): Promise<CaseSummary | null> {
  return saveEvidence(db, caseId, (brief) => {
    const kept = (brief.nicheJobs ?? []).filter((j) => j.angle !== job.angle)
    return {
      ...brief,
      nicheJobs: [...(kept.length >= NICHE_TESTS_MAX ? kept.slice(1) : kept), job],
    }
  })
}

/** Forget the pending niche job for an angle (it failed or expired at VidIQ). */
export async function dropCaseNicheJob(
  db: Database,
  caseId: string,
  angle: string,
): Promise<CaseSummary | null> {
  return saveEvidence(db, caseId, (brief) => ({
    ...brief,
    nicheJobs: (brief.nicheJobs ?? []).filter((j) => j.angle !== angle),
  }))
}

/** Set the format a case is made as; null clears it back to the primary. */
export async function setCaseFormat(
  db: Database,
  caseId: string,
  formatKey: string | null,
): Promise<void> {
  await db.update(cases).set({ formatKey, updatedAt: new Date() }).where(eq(cases.id, caseId))
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

export async function truncateCases(db: Database): Promise<void> {
  await db.execute(sql`truncate table ${cases} restart identity cascade`)
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

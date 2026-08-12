import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { sentenceHash } from '@boom-busters/schemas'
import type { GutterWarning, ShortsCandidate } from '@boom-busters/schemas'
import type { Database } from './client'
import { chapters, claimRefs, claims, dossiers, scriptEdits, scripts } from './schema'
import type { ChapterRow, EditType, ScriptRow, ScriptStatus } from './schema'

/**
 * Script, chapter and edit-trail queries (build spec sections 5, 7.2, 11.3).
 *
 * `script_edits` is the part that is not merely convenient: spec section 5
 * calls it "the human-curation evidence trail". Every human edit and every
 * regenerate is recorded with what it replaced, so the channel can show that a
 * person shaped the script rather than publishing a model's first draft
 * unread. Nothing writes a chapter without going through a function here that
 * records the change.
 */

export interface ChapterWithWarnings extends ChapterRow {
  warnings: GutterWarning[]
}

export interface ScriptWithChapters {
  script: ScriptRow
  chapters: ChapterWithWarnings[]
}

/**
 * Start a new script version for a project.
 *
 * Versions rather than overwrites: a re-run after a change request must not
 * destroy the script a human already edited, because those edits are the
 * evidence trail.
 */
/**
 * Start a new script version, stamped with the dossier it is about to be
 * written from.
 *
 * The stamp is what makes staleness derivable: re-researching the dossier bumps
 * `dossiers.version`, and every script whose `builtFromDossierVersion` is
 * behind it is, by definition, narration written from research that has since
 * been replaced. Recording it at creation rather than at completion is
 * deliberate — a run that dies halfway still leaves chapters behind, and those
 * chapters came from a knowable dossier.
 */
export async function createScriptVersion(db: Database, projectId: string): Promise<ScriptRow> {
  const [latest] = await db
    .select({ version: scripts.version })
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.version))
    .limit(1)

  const [dossier] = await db
    .select({ version: dossiers.version })
    .from(dossiers)
    .where(eq(dossiers.projectId, projectId))
    .limit(1)

  const [row] = await db
    .insert(scripts)
    .values({
      projectId,
      version: (latest?.version ?? 0) + 1,
      status: 'draft',
      ...(dossier ? { builtFromDossierVersion: dossier.version } : {}),
    })
    .returning()

  return row!
}

export async function getLatestScript(
  db: Database,
  projectId: string,
): Promise<ScriptWithChapters | undefined> {
  const [script] = await db
    .select()
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.version))
    .limit(1)

  if (!script) return undefined

  const rows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.scriptId, script.id))
    .orderBy(asc(chapters.index))

  return { script, chapters: rows as ChapterWithWarnings[] }
}

export async function saveChapter(
  db: Database,
  input: {
    scriptId: string
    index: number
    title: string
    contentMd: string
    estRuntimeSec: number
  },
): Promise<ChapterRow> {
  const [row] = await db
    .insert(chapters)
    .values(input)
    .onConflictDoUpdate({
      target: [chapters.scriptId, chapters.index],
      set: {
        title: input.title,
        contentMd: input.contentMd,
        estRuntimeSec: input.estRuntimeSec,
        updatedAt: new Date(),
      },
    })
    .returning()

  return row!
}

/**
 * Replace a chapter's text, recording what it replaced.
 *
 * The edit row is written in the same transaction as the change. A trail that
 * can be missing entries for the edits that mattered is not a trail.
 */
export async function editChapter(
  db: Database,
  input: {
    chapterId: string
    afterText: string
    editType: EditType
    note?: string | null
    estRuntimeSec: number
  },
): Promise<ChapterRow | undefined> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ contentMd: chapters.contentMd })
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1)

    if (!before) return undefined
    // A save that changed nothing is not an edit. Recording it would bury the
    // real edits under autosave noise.
    if (before.contentMd === input.afterText) {
      const [unchanged] = await tx
        .select()
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))
        .limit(1)
      return unchanged
    }

    await tx.insert(scriptEdits).values({
      chapterId: input.chapterId,
      beforeText: before.contentMd,
      afterText: input.afterText,
      editType: input.editType,
      note: input.note ?? null,
    })

    const [row] = await tx
      .update(chapters)
      .set({
        contentMd: input.afterText,
        estRuntimeSec: input.estRuntimeSec,
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, input.chapterId))
      .returning()

    return row
  })
}

export async function setChapterWarnings(
  db: Database,
  chapterId: string,
  warnings: readonly GutterWarning[],
): Promise<void> {
  await db
    .update(chapters)
    .set({ warnings: [...warnings], updatedAt: new Date() })
    .where(eq(chapters.id, chapterId))
}

/**
 * Pin claims to the sentences that used them.
 *
 * A ref whose `claimId` is not a real claim on this project is dropped rather
 * than inserted: the self-check pass reports ids a model typed, and a
 * mistyped id would otherwise fail the whole step on a foreign key.
 */
export async function saveClaimRefs(
  db: Database,
  input: {
    chapterId: string
    projectId: string
    refs: readonly { claimId: string; sentence: string }[]
  },
): Promise<number> {
  await db.delete(claimRefs).where(eq(claimRefs.chapterId, input.chapterId))
  if (input.refs.length === 0) return 0

  const valid = new Set(
    (
      await db
        .select({ id: claims.id })
        .from(claims)
        .innerJoin(dossiers, eq(claims.dossierId, dossiers.id))
        .where(eq(dossiers.projectId, input.projectId))
    ).map((row) => row.id),
  )

  const rows = input.refs
    .filter((ref) => valid.has(ref.claimId))
    .map((ref) => ({
      chapterId: input.chapterId,
      claimId: ref.claimId,
      sentenceHash: sentenceHash(ref.sentence),
    }))

  // The unique index is (chapter, claim, sentence): a model reporting the same
  // pairing twice is normal, not an error.
  const deduped = [
    ...new Map(rows.map((row) => [`${row.claimId}:${row.sentenceHash}`, row])).values(),
  ]
  if (deduped.length === 0) return 0

  await db.insert(claimRefs).values(deduped).onConflictDoNothing()
  return deduped.length
}

export async function listClaimRefs(db: Database, chapterId: string) {
  return db
    .select({
      claimId: claimRefs.claimId,
      sentenceHash: claimRefs.sentenceHash,
      text: claims.text,
      sourceUrl: claims.sourceUrl,
      confidence: claims.confidence,
    })
    .from(claimRefs)
    .innerJoin(claims, eq(claims.id, claimRefs.claimId))
    .where(eq(claimRefs.chapterId, chapterId))
}

export async function listScriptEdits(db: Database, chapterIds: readonly string[]) {
  if (chapterIds.length === 0) return []

  return db
    .select()
    .from(scriptEdits)
    .where(inArray(scriptEdits.chapterId, [...chapterIds]))
    .orderBy(desc(scriptEdits.createdAt))
}

export async function setScriptStatus(
  db: Database,
  scriptId: string,
  status: ScriptStatus,
): Promise<void> {
  await db.update(scripts).set({ status, updatedAt: new Date() }).where(eq(scripts.id, scriptId))
}

/** Every warning across a script — the count the gate card shows. */
export function countWarnings(chapters: readonly ChapterWithWarnings[]): number {
  return chapters.reduce((total, chapter) => total + chapter.warnings.length, 0)
}

export async function getChapter(
  db: Database,
  chapterId: string,
): Promise<ChapterWithWarnings | undefined> {
  const [row] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1)
  return row as ChapterWithWarnings | undefined
}

/** The project a chapter belongs to, for authorising an edit. */
export async function projectIdForChapter(
  db: Database,
  chapterId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ projectId: scripts.projectId })
    .from(chapters)
    .innerJoin(scripts, eq(scripts.id, chapters.scriptId))
    .where(eq(chapters.id, chapterId))
    .limit(1)

  return row?.projectId
}

export async function truncateScripts(db: Database): Promise<void> {
  await db.execute(sql`truncate table ${scripts} restart identity cascade`)
}

/**
 * Store the Shorts segments the runner marked.
 *
 * Previously the runner generated these, the gate card counted them, and
 * nothing kept them — so Script Studio was handed an empty list and said
 * "None marked in this chapter" beside a gate claiming five. A paid model call
 * was thrown away on every script run.
 */
export async function setShortsCandidates(
  db: Database,
  scriptId: string,
  candidates: readonly ShortsCandidate[],
): Promise<void> {
  await db
    .update(scripts)
    .set({ shortsCandidates: [...candidates], updatedAt: new Date() })
    .where(eq(scripts.id, scriptId))
}

/**
 * Put a script's chapters in a new order.
 *
 * Two phases inside one transaction. `(scriptId, index)` is unique, so writing
 * the final indexes directly collides the moment two chapters swap: the first
 * update lands on an index the second still holds. Parking everything at
 * negative indexes first vacates the range, and negatives can never collide
 * with a real index because the column is only ever written as 0 or greater.
 *
 * `claim_refs` are untouched. They key on `chapterId` and a sentence hash,
 * neither of which reordering changes — an earlier note in PROGRESS.md
 * claimed otherwise and was wrong.
 *
 * What reordering *does* invalidate is the prose. Chapters were drafted
 * sequentially, each seamed onto the tail of the one before, so a moved
 * chapter opens by referring to something the audience has not met yet. That
 * is the caller's problem to surface, not something to silently repair.
 */
export async function reorderChapters(
  db: Database,
  scriptId: string,
  orderedChapterIds: readonly string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.scriptId, scriptId))

  const known = new Set(existing.map((row) => row.id))

  if (orderedChapterIds.length !== known.size) {
    return {
      ok: false,
      error: `Expected ${known.size} chapters in the new order, got ${orderedChapterIds.length}.`,
    }
  }
  if (new Set(orderedChapterIds).size !== orderedChapterIds.length) {
    return { ok: false, error: 'The new order lists the same chapter twice.' }
  }
  if (orderedChapterIds.some((id) => !known.has(id))) {
    return { ok: false, error: 'The new order names a chapter from another script.' }
  }

  await db.transaction(async (tx) => {
    for (const [position, id] of orderedChapterIds.entries()) {
      await tx
        .update(chapters)
        .set({ index: -(position + 1) })
        .where(eq(chapters.id, id))
    }
    for (const [position, id] of orderedChapterIds.entries()) {
      await tx
        .update(chapters)
        .set({ index: position, updatedAt: new Date() })
        .where(eq(chapters.id, id))
    }
  })

  return { ok: true }
}

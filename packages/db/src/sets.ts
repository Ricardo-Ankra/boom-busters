import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { MAX_SET_PLATES, ProjectSetSchema, ValidationError } from '@boom-busters/schemas'
import type { ProjectSet, SetPlate } from '@boom-busters/schemas'
import type { Database } from './client'
import { projectSets } from './schema'
import type { ProjectSetRow } from './schema'

/**
 * The set library (decision 264): a project's rooms and the reference plates
 * that keep each one the same room in every shot of it.
 *
 * Deliberately `cast.ts` with different nouns, down to the dismissal
 * behaviour, because a producer who has learned the Cast card has learned
 * this one too. The Director's Book seeds both.
 */

function toSet(row: ProjectSetRow): ProjectSet {
  return ProjectSetSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    look: row.look,
    plates: row.plates,
  })
}

const active = (projectId: string) =>
  and(eq(projectSets.projectId, projectId), isNull(projectSets.dismissedAt))

export async function listProjectSets(db: Database, projectId: string): Promise<ProjectSet[]> {
  const rows = await db
    .select()
    .from(projectSets)
    .where(active(projectId))
    // The id breaks the tie: two sets seeded in one statement share a
    // timestamp, and ULIDs are monotonic, so this is insertion order.
    .orderBy(asc(projectSets.createdAt), asc(projectSets.id))
  return rows.map(toSet)
}

export async function getProjectSet(db: Database, id: string): Promise<ProjectSet | null> {
  const [row] = await db
    .select()
    .from(projectSets)
    .where(and(eq(projectSets.id, id), isNull(projectSets.dismissedAt)))
    .limit(1)
  return row ? toSet(row) : null
}

/**
 * Add a set by hand. Re-adding one the producer dismissed revives the same
 * row (the unique name index would refuse a second one), with the new look;
 * the plates were deleted at dismissal and start empty.
 *
 * The match ignores case, because everything else that joins a name to a set
 * does: seeding and `nameMatches` both do, and an exact-case lookup here let
 * "the lobby" be added beside a dismissed "The Lobby".
 */
export async function insertProjectSet(
  db: Database,
  input: { projectId: string; name: string; look?: string },
): Promise<ProjectSet> {
  const name = input.name.trim()
  const look = (input.look ?? '').trim()
  if (!name) throw new ValidationError('A set needs a name.', { field: 'name' })
  const [same] = await db
    .select({ id: projectSets.id, dismissedAt: projectSets.dismissedAt })
    .from(projectSets)
    .where(
      and(
        eq(projectSets.projectId, input.projectId),
        sql`lower(${projectSets.name}) = lower(${name})`,
      ),
    )
    .limit(1)
  if (same && same.dismissedAt === null) {
    throw new ValidationError('A set with that exact name already exists.', {
      field: 'name',
    })
  }
  if (same) {
    const [revived] = await db
      .update(projectSets)
      .set({ look, dismissedAt: null, plates: [], updatedAt: new Date() })
      .where(eq(projectSets.id, same.id))
      .returning()
    return toSet(revived!)
  }
  const [row] = await db
    .insert(projectSets)
    .values({ projectId: input.projectId, name, look })
    .returning()
  return toSet(row!)
}

export async function updateProjectSet(
  db: Database,
  id: string,
  patch: Partial<Pick<ProjectSet, 'name' | 'look'>>,
): Promise<ProjectSet> {
  const values: Partial<typeof projectSets.$inferInsert> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('A set needs a name.', { field: 'name' })
    values.name = name
  }
  if (patch.look !== undefined) values.look = patch.look.trim()
  const [row] = await db
    .update(projectSets)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(projectSets.id, id), isNull(projectSets.dismissedAt)))
    .returning()
  if (!row) throw new ValidationError(`Set ${id} no longer exists`, { field: 'id' })
  return toSet(row)
}

/** Replace the plate list. At most four; the schema and this check agree. */
export async function setSetPlates(
  db: Database,
  id: string,
  plates: readonly SetPlate[],
): Promise<ProjectSet> {
  if (plates.length > MAX_SET_PLATES) {
    throw new ValidationError(`A set keeps at most ${MAX_SET_PLATES} plates; remove one first.`, {
      field: 'plates',
    })
  }
  const [row] = await db
    .update(projectSets)
    .set({ plates: plates as unknown as Record<string, unknown>[], updatedAt: new Date() })
    .where(and(eq(projectSets.id, id), isNull(projectSets.dismissedAt)))
    .returning()
  if (!row) throw new ValidationError(`Set ${id} no longer exists`, { field: 'id' })
  return toSet(row)
}

/**
 * "Remove set": the row is kept, marked dismissed and emptied of plates (the
 * caller deletes the objects). The name is remembered so a redraft of the
 * Director's Book does not seed the same set again.
 */
export async function dismissProjectSet(db: Database, id: string): Promise<void> {
  await db
    .update(projectSets)
    .set({ dismissedAt: new Date(), plates: [], updatedAt: new Date() })
    .where(eq(projectSets.id, id))
}

/** Hard delete, for tests and for tearing a project's sets down completely. */
export async function deleteProjectSet(db: Database, id: string): Promise<void> {
  await db.delete(projectSets).where(eq(projectSets.id, id))
}

/**
 * Seed the sets from a freshly drafted Director's Book (decision 264).
 *
 * Every named location becomes a set, with the book's look line, so the name
 * and description are written before the producer opens the card. A name
 * already in the sets, live or dismissed, compared without regard to case,
 * is left alone: what the producer edited or removed stays edited or
 * removed. Returns the sets it added.
 */
export async function seedSetsFromLocations(
  db: Database,
  projectId: string,
  locations: readonly { name: string; look: string }[],
): Promise<ProjectSet[]> {
  const existing = await db
    .select({ name: projectSets.name })
    .from(projectSets)
    .where(eq(projectSets.projectId, projectId))
  const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()))

  const added: ProjectSet[] = []
  for (const location of locations) {
    const name = location.name.trim()
    const key = name.toLowerCase()
    if (!name || taken.has(key)) continue
    taken.add(key)
    const [row] = await db
      .insert(projectSets)
      .values({
        projectId,
        name,
        look: location.look.trim(),
      })
      // Two drafts racing on the same book must not fail the step.
      .onConflictDoNothing()
      .returning()
    if (row) added.push(toSet(row))
  }
  return added
}

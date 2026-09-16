import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { CastMemberSchema, MAX_CAST_PHOTOS, ValidationError } from '@boom-busters/schemas'
import type { CastMember, CastPhoto, Principal } from '@boom-busters/schemas'
import type { Database } from './client'
import { castMembers } from './schema'
import type { CastMemberRow } from './schema'

/**
 * The cast (decision 253): per-project reference people and their photos.
 * Read by the Cast card, the Director's Book drafter (names, roles, identity
 * strings) and still generation (`castMembersNamed` on a slot's `depicts`).
 *
 * The cast is seeded from the book's principals each time the book is
 * drafted (decision 253 (j)), so the producer's only job is the photograph.
 * A person the producer removes is dismissed rather than deleted: the row
 * stays, invisible, so the next draft cannot bring them back. Every reader
 * here skips dismissed rows; only the seeder and `insertCastMember` see them.
 */

function toMember(row: CastMemberRow): CastMember {
  return CastMemberSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    role: row.role,
    identityString: row.identityString,
    guardrail: row.guardrail,
    photos: row.photos,
  })
}

const active = (projectId: string) =>
  and(eq(castMembers.projectId, projectId), isNull(castMembers.dismissedAt))

export async function listCastMembers(db: Database, projectId: string): Promise<CastMember[]> {
  const rows = await db
    .select()
    .from(castMembers)
    .where(active(projectId))
    .orderBy(asc(castMembers.createdAt))
  return rows.map(toMember)
}

export async function getCastMember(db: Database, id: string): Promise<CastMember | null> {
  const [row] = await db
    .select()
    .from(castMembers)
    .where(and(eq(castMembers.id, id), isNull(castMembers.dismissedAt)))
    .limit(1)
  return row ? toMember(row) : null
}

/**
 * Add a person by hand. Re-adding someone the producer dismissed revives the
 * same row (the unique name index would refuse a second one), with the new
 * role and whatever identity string and guardrail it already held; the
 * photos were deleted at dismissal and start empty.
 */
export async function insertCastMember(
  db: Database,
  input: { projectId: string; name: string; role: string },
): Promise<CastMember> {
  const name = input.name.trim()
  const role = input.role.trim()
  if (!name) throw new ValidationError('A cast member needs a name.', { field: 'name' })
  if (!role) throw new ValidationError('A cast member needs a role.', { field: 'role' })
  const [same] = await db
    .select({ id: castMembers.id, dismissedAt: castMembers.dismissedAt })
    .from(castMembers)
    .where(and(eq(castMembers.projectId, input.projectId), eq(castMembers.name, name)))
    .limit(1)
  if (same && same.dismissedAt === null) {
    throw new ValidationError('Someone with that exact name is already in the cast.', {
      field: 'name',
    })
  }
  if (same) {
    const [revived] = await db
      .update(castMembers)
      .set({ role, dismissedAt: null, photos: [], updatedAt: new Date() })
      .where(eq(castMembers.id, same.id))
      .returning()
    return toMember(revived!)
  }
  const [row] = await db
    .insert(castMembers)
    .values({ projectId: input.projectId, name, role })
    .returning()
  return toMember(row!)
}

export async function updateCastMember(
  db: Database,
  id: string,
  patch: Partial<Pick<CastMember, 'name' | 'role' | 'identityString' | 'guardrail'>>,
): Promise<CastMember> {
  const values: Partial<typeof castMembers.$inferInsert> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ValidationError('A cast member needs a name.', { field: 'name' })
    values.name = name
  }
  if (patch.role !== undefined) values.role = patch.role.trim()
  if (patch.identityString !== undefined) values.identityString = patch.identityString.trim()
  if (patch.guardrail !== undefined) values.guardrail = patch.guardrail.trim()
  const [row] = await db
    .update(castMembers)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(castMembers.id, id), isNull(castMembers.dismissedAt)))
    .returning()
  if (!row) throw new ValidationError(`Cast member ${id} no longer exists`, { field: 'id' })
  return toMember(row)
}

/** Replace the photo list. At most four; the schema and this check agree. */
export async function setCastPhotos(
  db: Database,
  id: string,
  photos: readonly CastPhoto[],
): Promise<CastMember> {
  if (photos.length > MAX_CAST_PHOTOS) {
    throw new ValidationError(
      `A cast member keeps at most ${MAX_CAST_PHOTOS} photos; remove one first.`,
      { field: 'photos' },
    )
  }
  const [row] = await db
    .update(castMembers)
    .set({ photos: photos as unknown as Record<string, unknown>[], updatedAt: new Date() })
    .where(and(eq(castMembers.id, id), isNull(castMembers.dismissedAt)))
    .returning()
  if (!row) throw new ValidationError(`Cast member ${id} no longer exists`, { field: 'id' })
  return toMember(row)
}

/**
 * "Remove person": the row is kept, marked dismissed and emptied of photos
 * (the caller deletes the objects). The name is remembered so a redraft of
 * the Director's Book does not seed the same person again.
 */
export async function dismissCastMember(db: Database, id: string): Promise<void> {
  await db
    .update(castMembers)
    .set({ dismissedAt: new Date(), photos: [], updatedAt: new Date() })
    .where(eq(castMembers.id, id))
}

/** Hard delete, for tests and for tearing a project's cast down completely. */
export async function deleteCastMember(db: Database, id: string): Promise<void> {
  await db.delete(castMembers).where(eq(castMembers.id, id))
}

/** Members whose exact name appears in `names`: the lookup generation runs on a slot's `depicts`. */
export async function castMembersNamed(
  db: Database,
  projectId: string,
  names: readonly string[],
): Promise<CastMember[]> {
  const wanted = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (wanted.length === 0) return []
  const rows = await db
    .select()
    .from(castMembers)
    .where(and(active(projectId), inArray(castMembers.name, wanted)))
    .orderBy(asc(castMembers.createdAt))
  return rows.map(toMember)
}

/**
 * Seed the cast from a freshly drafted Director's Book (decision 253 (j)).
 *
 * Every named principal becomes a member, with the book's role, identity
 * string and guardrail, so the name and description are written before the
 * producer opens the card. Anonymous principals are unnamed by definition
 * and are skipped. A name already in the cast, live or dismissed, compared
 * without regard to case, is left alone: what the producer edited or removed
 * stays edited or removed. Returns the members it added.
 */
export async function seedCastFromPrincipals(
  db: Database,
  projectId: string,
  principals: readonly Principal[],
): Promise<CastMember[]> {
  const existing = await db
    .select({ name: castMembers.name })
    .from(castMembers)
    .where(eq(castMembers.projectId, projectId))
  const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()))

  const added: CastMember[] = []
  for (const principal of principals) {
    if (principal.depiction === 'anonymous') continue
    const name = principal.name.trim()
    const key = name.toLowerCase()
    if (!name || taken.has(key)) continue
    taken.add(key)
    const [row] = await db
      .insert(castMembers)
      .values({
        projectId,
        name,
        role: principal.role.trim(),
        identityString: principal.identityString.trim(),
        guardrail: principal.guardrail.trim(),
      })
      // Two drafts racing on the same book must not fail the step.
      .onConflictDoNothing()
      .returning()
    if (row) added.push(toMember(row))
  }
  return added
}

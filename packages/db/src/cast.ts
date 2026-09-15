import { and, asc, eq, inArray } from 'drizzle-orm'
import { CastMemberSchema, MAX_CAST_PHOTOS, ValidationError } from '@boom-busters/schemas'
import type { CastMember, CastPhoto } from '@boom-busters/schemas'
import type { Database } from './client'
import { castMembers } from './schema'
import type { CastMemberRow } from './schema'

/**
 * The cast (decision 253): per-project reference people and their photos.
 * Read by the Cast card, the Director's Book drafter (names, roles, identity
 * strings) and still generation (`castMembersNamed` on a slot's `depicts`).
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

export async function listCastMembers(db: Database, projectId: string): Promise<CastMember[]> {
  const rows = await db
    .select()
    .from(castMembers)
    .where(eq(castMembers.projectId, projectId))
    .orderBy(asc(castMembers.createdAt))
  return rows.map(toMember)
}

export async function getCastMember(db: Database, id: string): Promise<CastMember | null> {
  const [row] = await db.select().from(castMembers).where(eq(castMembers.id, id)).limit(1)
  return row ? toMember(row) : null
}

export async function insertCastMember(
  db: Database,
  input: { projectId: string; name: string; role: string },
): Promise<CastMember> {
  const name = input.name.trim()
  const role = input.role.trim()
  if (!name) throw new ValidationError('A cast member needs a name.', { field: 'name' })
  if (!role) throw new ValidationError('A cast member needs a role.', { field: 'role' })
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
    .where(eq(castMembers.id, id))
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
    .where(eq(castMembers.id, id))
    .returning()
  if (!row) throw new ValidationError(`Cast member ${id} no longer exists`, { field: 'id' })
  return toMember(row)
}

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
    .where(and(eq(castMembers.projectId, projectId), inArray(castMembers.name, wanted)))
    .orderBy(asc(castMembers.createdAt))
  return rows.map(toMember)
}

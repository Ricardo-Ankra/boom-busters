import { ValidationError } from '@boom-busters/schemas'
import type { CastPhoto } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import {
  castMembersNamed,
  deleteCastMember,
  getCastMember,
  insertCastMember,
  listCastMembers,
  setCastPhotos,
  updateCastMember,
} from './cast'
import { createDb } from './client'
import { createProjectFromCase, deleteProjectsExcept } from './projects'
import { requireTestDatabase } from './test-database'

/**
 * The cast table (decision 253) against the test container: one name per
 * project, four photos at most, gone with the project.
 */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function photo(hash: string, view: CastPhoto['view'] = 'front'): CastPhoto {
  return {
    r2Key: `boom-busters/cast/p/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg',
    width: 800,
    height: 1000,
    view,
  }
}

suite('cast members', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await deleteProjectsExcept(db, [])
    await truncateCases(db)
    const kase = await createCase(db, { title: 'Stability AI', category: 'collapse' })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Stability AI' })).id
  })

  it('inserts, lists in creation order, and reads back parsed', async () => {
    await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    await insertCastMember(db, { projectId, name: 'Prem Akkaraju', role: 'CEO' })
    const members = await listCastMembers(db, projectId)
    expect(members.map((m) => m.name)).toEqual(['Emad Mostaque', 'Prem Akkaraju'])
    expect(members[0]).toMatchObject({ identityString: '', guardrail: '', photos: [] })
  })

  it('keeps one entry per name per project', async () => {
    await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    await expect(
      insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Again' }),
    ).rejects.toThrow()
  })

  it('refuses a blank name', async () => {
    await expect(insertCastMember(db, { projectId, name: '  ', role: 'x' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('updates text fields and trims them', async () => {
    const member = await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    const updated = await updateCastMember(db, member.id, {
      identityString: '  oval face, short dark hair  ',
      guardrail: 'never in handcuffs',
    })
    expect(updated.identityString).toBe('oval face, short dark hair')
    expect((await getCastMember(db, member.id))?.guardrail).toBe('never in handcuffs')
  })

  it('caps photos at four', async () => {
    const member = await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    const four = ['a', 'b', 'c', 'd'].map((h) => photo(h, 'other'))
    expect((await setCastPhotos(db, member.id, four)).photos).toHaveLength(4)
    await expect(setCastPhotos(db, member.id, [...four, photo('e')])).rejects.toThrow(
      ValidationError,
    )
  })

  it('finds members by exact name only', async () => {
    await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    await insertCastMember(db, { projectId, name: 'Prem Akkaraju', role: 'CEO' })
    const found = await castMembersNamed(db, projectId, ['Emad Mostaque', 'Emad', 'Nobody'])
    expect(found.map((m) => m.name)).toEqual(['Emad Mostaque'])
    expect(await castMembersNamed(db, projectId, [])).toEqual([])
  })

  it('deletes a member, and the project deletion cascades the rest', async () => {
    const a = await insertCastMember(db, { projectId, name: 'A', role: 'x' })
    await insertCastMember(db, { projectId, name: 'B', role: 'y' })
    await deleteCastMember(db, a.id)
    expect((await listCastMembers(db, projectId)).map((m) => m.name)).toEqual(['B'])
    await deleteProjectsExcept(db, [])
    expect(await listCastMembers(db, projectId)).toEqual([])
  })
})

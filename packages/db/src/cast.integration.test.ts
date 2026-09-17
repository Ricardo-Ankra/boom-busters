import { ValidationError } from '@boom-busters/schemas'
import type { CastPhoto } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import {
  deleteCastMember,
  dismissCastMember,
  getCastMember,
  insertCastMember,
  listCastMembers,
  seedCastFromPrincipals,
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

  it('keeps one entry per name per project, and says so in words', async () => {
    await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    await expect(
      insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Again' }),
    ).rejects.toThrow(/already in the cast/)
  })

  it('dismisses a person: hidden everywhere, photos gone, name remembered', async () => {
    const member = await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'Founder' })
    await setCastPhotos(db, member.id, [photo('a')])
    await dismissCastMember(db, member.id)
    expect(await listCastMembers(db, projectId)).toEqual([])
    expect(await getCastMember(db, member.id)).toBeNull()
    await expect(updateCastMember(db, member.id, { role: 'x' })).rejects.toThrow(ValidationError)

    // Re-adding by hand revives the same row, with no photos and the new role.
    const back = await insertCastMember(db, { projectId, name: 'Emad Mostaque', role: 'CEO' })
    expect(back.id).toBe(member.id)
    expect(back).toMatchObject({ role: 'CEO', photos: [] })
    expect((await listCastMembers(db, projectId)).map((m) => m.name)).toEqual(['Emad Mostaque'])
  })

  describe('seedCastFromPrincipals', () => {
    const principals = [
      {
        name: 'Emad Mostaque',
        role: 'Founder and former CEO',
        depiction: 'likeness' as const,
        identityString: 'Emad Mostaque, founder: oval face, short dark hair, close-cropped beard',
        guardrail: 'never handling cash; never in handcuffs; never mocked',
      },
      {
        name: 'The chief financial officer',
        role: 'CFO',
        depiction: 'anonymous' as const,
        identityString: 'man in his forties, face turned from camera',
        guardrail: 'never at a desk with documents',
      },
      {
        name: 'Prem Akkaraju',
        role: 'CEO from 2024',
        depiction: 'archival-only' as const,
        identityString: 'Prem Akkaraju, chief executive: dark hair, clean shaven',
        guardrail: 'never mocked',
      },
    ]

    it('adds every named principal with the book text, and skips anonymous ones', async () => {
      const added = await seedCastFromPrincipals(db, projectId, principals)
      expect(added.map((m) => m.name)).toEqual(['Emad Mostaque', 'Prem Akkaraju'])
      const [emad] = await listCastMembers(db, projectId)
      expect(emad).toMatchObject({
        role: 'Founder and former CEO',
        identityString: principals[0]!.identityString,
        guardrail: principals[0]!.guardrail,
        photos: [],
      })
    })

    it('leaves existing members alone, whatever their case, and does not revive the dismissed', async () => {
      const edited = await insertCastMember(db, {
        projectId,
        name: 'emad mostaque',
        role: 'Founder',
      })
      await updateCastMember(db, edited.id, { identityString: 'written by the producer' })
      const gone = await insertCastMember(db, { projectId, name: 'Prem Akkaraju', role: 'CEO' })
      await dismissCastMember(db, gone.id)

      const added = await seedCastFromPrincipals(db, projectId, principals)
      expect(added).toEqual([])
      const members = await listCastMembers(db, projectId)
      expect(members.map((m) => m.name)).toEqual(['emad mostaque'])
      expect(members[0]?.identityString).toBe('written by the producer')

      // A second draft adds nothing either.
      expect(await seedCastFromPrincipals(db, projectId, principals)).toEqual([])
    })
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

  it('deletes a member, and the project deletion cascades the rest', async () => {
    const a = await insertCastMember(db, { projectId, name: 'A', role: 'x' })
    await insertCastMember(db, { projectId, name: 'B', role: 'y' })
    await deleteCastMember(db, a.id)
    expect((await listCastMembers(db, projectId)).map((m) => m.name)).toEqual(['B'])
    await deleteProjectsExcept(db, [])
    expect(await listCastMembers(db, projectId)).toEqual([])
  })
})

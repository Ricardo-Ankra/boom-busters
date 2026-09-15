// @vitest-environment node

import { FIXTURE_PROJECT_ID, listCastMembers, requireTestDatabase, seed } from '@boom-busters/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addCastMemberAction,
  createCastPhotoUploadAction,
  describeCastMemberAction,
  finaliseCastPhotoAction,
  removeCastMemberAction,
  removeCastPhotoAction,
  updateCastMemberAction,
} from './cast-actions'

/**
 * The Cast card's actions (decision 253) against the test database, with the
 * seams a server action cannot bring to a unit test replaced: session, cache
 * revalidation, and R2, which answers as if every upload landed.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const storage = vi.hoisted(() => ({
  configured: true,
  deleted: [] as string[],
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  castPhotoKey: (input: { projectId: string; contentHash: string; ext: string }) =>
    `boom-busters/cast/${input.projectId}/${input.contentHash}.${input.ext}`,
  presignPut: async (key: string) => `https://r2.example/${key}?signed`,
  headObject: async () => ({ size: 120_000, contentType: 'image/jpeg' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
  getObjectBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describeDb('cast actions (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    storage.configured = true
    storage.deleted = []
    await seed(db)
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await removeCastMemberAction(member.id)
    }
  })

  async function addEmad(): Promise<string> {
    const added = await addCastMemberAction(FIXTURE_PROJECT_ID, {
      name: 'Emad Mostaque',
      role: 'Founder and former CEO, Stability AI',
    })
    expect(added.ok).toBe(true)
    return added.id!
  }

  it('adds, edits and removes a person', async () => {
    const id = await addEmad()
    expect(await updateCastMemberAction(id, { guardrail: 'never in handcuffs' })).toEqual({
      ok: true,
    })
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.guardrail).toBe('never in handcuffs')
    expect(await removeCastMemberAction(id)).toEqual({ ok: true })
    expect(await listCastMembers(db, FIXTURE_PROJECT_ID)).toEqual([])
  })

  it('refuses a second entry with the same exact name, in words', async () => {
    await addEmad()
    const again = await addCastMemberAction(FIXTURE_PROJECT_ID, {
      name: 'Emad Mostaque',
      role: 'x',
    })
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/already in the cast/)
  })

  it('issues a presigned PUT for a JPEG and refuses a GIF', async () => {
    const id = await addEmad()
    const ok = await createCastPhotoUploadAction({
      memberId: id,
      mimeType: 'image/jpeg',
      fileSize: 120_000,
      contentHash: HASH_A,
    })
    expect(ok.ok).toBe(true)
    expect(ok.key).toBe(`boom-busters/cast/${FIXTURE_PROJECT_ID}/${HASH_A}.jpg`)
    expect(ok.url).toContain('?signed')

    const gif = await createCastPhotoUploadAction({
      memberId: id,
      mimeType: 'image/gif',
      fileSize: 1000,
      contentHash: HASH_B,
    })
    expect(gif.ok).toBe(false)
    expect(gif.error).toMatch(/JPEG, PNG or WebP/)
  })

  it('records a finalised photo and writes the identity string from the first one', async () => {
    const id = await addEmad()
    const done = await finaliseCastPhotoAction({
      memberId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 1200,
      height: 1600,
      view: 'front',
    })
    expect(done).toEqual({ ok: true })
    const [member] = await listCastMembers(db, FIXTURE_PROJECT_ID)
    expect(member?.photos).toHaveLength(1)
    expect(member?.photos[0]).toMatchObject({ view: 'front', width: 1200, height: 1600 })
    expect(member?.identityString).toContain('[mock] Emad Mostaque')
    expect(member?.guardrail).toContain('never in handcuffs')

    // A second photo does not overwrite an identity string that now exists.
    await updateCastMemberAction(id, { identityString: 'edited by the producer' })
    await finaliseCastPhotoAction({
      memberId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_B,
      width: 800,
      height: 800,
      view: 'profile',
    })
    const [after] = await listCastMembers(db, FIXTURE_PROJECT_ID)
    expect(after?.photos).toHaveLength(2)
    expect(after?.identityString).toBe('edited by the producer')
  })

  it('refuses a fifth photo', async () => {
    const id = await addEmad()
    for (const letter of ['1', '2', '3', '4']) {
      const done = await finaliseCastPhotoAction({
        memberId: id,
        mimeType: 'image/png',
        contentHash: letter.repeat(64),
        width: 10,
        height: 10,
        view: 'other',
      })
      expect(done.ok).toBe(true)
    }
    const fifth = await createCastPhotoUploadAction({
      memberId: id,
      mimeType: 'image/png',
      fileSize: 10,
      contentHash: '5'.repeat(64),
    })
    expect(fifth.ok).toBe(false)
    expect(fifth.error).toMatch(/already has 4 photos/)
  })

  it('removes a photo from storage and the row, and describe rewrites the text', async () => {
    const id = await addEmad()
    await finaliseCastPhotoAction({
      memberId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
      view: 'front',
    })
    await updateCastMemberAction(id, { identityString: 'stale' })
    expect(await describeCastMemberAction(id)).toEqual({ ok: true })
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.identityString).toContain('[mock]')

    expect(await removeCastPhotoAction({ memberId: id, contentHash: HASH_A })).toEqual({ ok: true })
    expect(storage.deleted).toContain(`boom-busters/cast/${FIXTURE_PROJECT_ID}/${HASH_A}.jpg`)
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.photos).toEqual([])
    const noPhotos = await describeCastMemberAction(id)
    expect(noPhotos.ok).toBe(false)
  })

  it('says so when storage is not configured', async () => {
    const id = await addEmad()
    storage.configured = false
    const result = await createCastPhotoUploadAction({
      memberId: id,
      mimeType: 'image/jpeg',
      fileSize: 10,
      contentHash: HASH_A,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/R2 configured/)
  })
})

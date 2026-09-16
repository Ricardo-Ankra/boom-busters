// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  listCastMembers,
  requireTestDatabase,
  seed,
  seedCastFromPrincipals,
} from '@boom-busters/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addCastMemberAction,
  addCastPhotoFromUrlAction,
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
  putObject: async (key: string) => ({ key }),
  headObject: async () => ({ size: 120_000, contentType: 'image/jpeg' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
  getObjectBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
}))

// The fetcher has its own suite (address rules, magic bytes, dimensions);
// here it only has to hand the action some bytes.
const remote = vi.hoisted(() => ({ fetchRemoteImage: vi.fn() }))
vi.mock('@/lib/remote-image', () => remote)

const describeDb = requireTestDatabase() ? describe : describe.skip

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describeDb('cast actions (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    storage.configured = true
    storage.deleted = []
    remote.fetchRemoteImage.mockResolvedValue({
      ok: true,
      image: {
        bytes: Buffer.from('a-real-jpeg'),
        mimeType: 'image/jpeg',
        width: 1200,
        height: 1600,
        resolvedUrl: 'https://example.com/emad.jpg',
      },
    })
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

  it('adds, edits and removes a person; removal deletes the photos and stays removed', async () => {
    const id = await addEmad()
    expect(await updateCastMemberAction(id, { guardrail: 'never in handcuffs' })).toEqual({
      ok: true,
    })
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.guardrail).toBe('never in handcuffs')
    await finaliseCastPhotoAction({
      memberId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
      view: 'front',
    })
    expect(await removeCastMemberAction(id)).toEqual({ ok: true })
    expect(storage.deleted).toContain(`boom-busters/cast/${FIXTURE_PROJECT_ID}/${HASH_A}.jpg`)
    expect(await listCastMembers(db, FIXTURE_PROJECT_ID)).toEqual([])
    // The book cannot seed them back; the producer can re-add them by hand.
    expect(
      await seedCastFromPrincipals(db, FIXTURE_PROJECT_ID, [
        {
          name: 'Emad Mostaque',
          role: 'Founder',
          depiction: 'likeness',
          identityString: 'x',
          guardrail: 'y',
        },
      ]),
    ).toEqual([])
    expect(await listCastMembers(db, FIXTURE_PROJECT_ID)).toEqual([])
    const back = await addCastMemberAction(FIXTURE_PROJECT_ID, {
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    expect(back).toMatchObject({ ok: true, id })
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

  it('adds a photo from a web address, keeping the address as provenance', async () => {
    const id = await addEmad()
    expect(
      await addCastPhotoFromUrlAction({
        memberId: id,
        url: 'https://example.com/emad.jpg',
        view: 'front',
      }),
    ).toEqual({ ok: true })

    const [member] = await listCastMembers(db, FIXTURE_PROJECT_ID)
    expect(member?.photos).toHaveLength(1)
    expect(member?.photos[0]).toMatchObject({
      view: 'front',
      width: 1200,
      height: 1600,
      mimeType: 'image/jpeg',
      sourceUrl: 'https://example.com/emad.jpg',
    })
    // Stored under the fingerprint of the bytes, exactly like an upload.
    expect(member?.photos[0]?.r2Key).toMatch(
      /^boom-busters\/cast\/[0-9A-Z]{26}\/[0-9a-f]{64}\.jpg$/,
    )
    // The first photo still writes the identity string.
    expect(member?.identityString).toContain('[mock] Emad Mostaque')
  })

  it('passes the fetcher’s refusal through in its own words', async () => {
    const id = await addEmad()
    remote.fetchRemoteImage.mockResolvedValue({
      ok: false,
      error: 'That site refuses downloads from a server. Save the image and use Add photo instead.',
    })
    const result = await addCastPhotoFromUrlAction({
      memberId: id,
      url: 'https://agency.example/x.jpg',
      view: 'front',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Add photo instead/)
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.photos).toEqual([])
  })

  it('refuses the same picture twice, however it arrived', async () => {
    const id = await addEmad()
    await addCastPhotoFromUrlAction({
      memberId: id,
      url: 'https://example.com/emad.jpg',
      view: 'front',
    })
    const again = await addCastPhotoFromUrlAction({
      memberId: id,
      url: 'https://mirror.example/same.jpg',
      view: 'profile',
    })
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/already has that exact photo/)
    expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.photos).toHaveLength(1)
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

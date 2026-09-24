// @vitest-environment node

import { createHash } from 'node:crypto'
import { truncateLedger } from '@boom-busters/cost'
import {
  deleteProjectSet,
  FIXTURE_PROJECT_ID,
  insertProjectSet,
  listProjectSets,
  requireTestDatabase,
  seed,
  updateSettings,
} from '@boom-busters/db'
import { mockImageGen } from '@boom-busters/providers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { MOCK_LAYOUT } from '@/lib/set-layout'
import {
  addSetAction,
  addSetPlateFromUrlAction,
  chooseSetPlateAction,
  createSetPlateUploadAction,
  finaliseSetPlateAction,
  generateSetPlateAction,
  redraftSetLayoutAction,
  removeSetAction,
  removeSetPlateAction,
  updateSetAction,
} from './set-actions'

/**
 * The Set card's actions (decision 264) against the test database, with the
 * seams a server action cannot bring to a unit test replaced: session, cache
 * revalidation, and R2, which answers as if every upload landed.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const storage = vi.hoisted(() => ({
  configured: true,
  deleted: [] as string[],
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  setPlateKey: (input: { projectId: string; contentHash: string; ext: string }) =>
    `boom-busters/sets/${input.projectId}/${input.contentHash}.${input.ext}`,
  presignPut: async (key: string) => `https://r2.example/${key}?signed`,
  putObject: async (key: string) => ({ key }),
  headObject: async () => ({ size: 120_000, contentType: 'image/jpeg' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
  getObjectBytes: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }),
  presignGet: async (key: string) => `https://r2.example/${key}?get`,
  stillKey: (input: { projectId: string; contentHash: string }) =>
    `boom-busters/stills/${input.projectId}/${input.contentHash}.png`,
}))

// The fetcher has its own suite (address rules, magic bytes, dimensions);
// here it only has to hand the action some bytes.
const remote = vi.hoisted(() => ({ fetchRemoteImage: vi.fn() }))
vi.mock('@/lib/remote-image', () => remote)

const describeDb = requireTestDatabase() ? describe : describe.skip

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

describeDb('set actions (mock mode)', () => {
  const generate = vi.spyOn(mockImageGen, 'generate')

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
        resolvedUrl: 'https://example.com/trading-floor.jpg',
      },
    })
    await seed(db)
    // The ledger is a real, shared table keyed on the wall-clock month: every
    // cost-guarded call across the whole suite writes into it, so without a
    // reset here `generateSetPlateAction` can trip a budget gate purely
    // because of how much other tests already spent this run.
    await truncateLedger(db)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    for (const set of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      await removeSetAction(set.id)
    }
    // A dismissed row still occupies the (project, name) unique index, so a
    // rename left over from an earlier run of this suite would otherwise
    // collide with "updates the name and the look". Revive-then-hard-delete
    // every fixed name this suite uses, so each run starts genuinely clean.
    for (const name of ['The trading floor', 'The boardroom']) {
      const revived = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name })
      await deleteProjectSet(db, revived.id)
    }
  })

  async function addTradingFloor(): Promise<string> {
    const added = await addSetAction(FIXTURE_PROJECT_ID, {
      name: 'The trading floor',
      look: 'cold blue light, rows of monitors',
    })
    expect(added.ok).toBe(true)
    return added.id!
  }

  it('adds a set and refuses a duplicate name in words, not a stack trace', async () => {
    await addTradingFloor()
    const again = await addSetAction(FIXTURE_PROJECT_ID, {
      name: 'The trading floor',
      look: 'a different look entirely',
    })
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/already exists/)
  })

  it('refuses a set with no name', async () => {
    const result = await addSetAction(FIXTURE_PROJECT_ID, { name: '   ', look: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/needs a name/)
  })

  it('updates the name and the look', async () => {
    const id = await addTradingFloor()
    expect(await updateSetAction(id, { name: 'The boardroom', look: 'warm brass light' })).toEqual({
      ok: true,
    })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set).toMatchObject({ name: 'The boardroom', look: 'warm brass light' })
  })

  // Decision 274, directions from 275: the card no longer asks; the first
  // upload is the room seen whole and anything after it another view.
  it('records an upload with no view as north first, then other', async () => {
    const id = await addTradingFloor()
    for (const hash of [HASH_A, HASH_B]) {
      expect(
        await finaliseSetPlateAction({
          setId: id,
          mimeType: 'image/jpeg',
          contentHash: hash,
          width: 10,
          height: 10,
        }),
      ).toEqual({ ok: true })
    }
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates.map((plate) => plate.view)).toEqual(['north', 'other'])
  })

  it('records an address with no view the same way', async () => {
    const id = await addTradingFloor()
    expect(
      await addSetPlateFromUrlAction({ setId: id, url: 'https://example.com/trading-floor.jpg' }),
    ).toEqual({ ok: true })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates[0]?.view).toBe('north')
  })

  it('removing a set deletes its plate objects and hides it', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
      view: 'north',
    })
    expect(await removeSetAction(id)).toEqual({ ok: true })
    expect(storage.deleted).toContain(`boom-busters/sets/${FIXTURE_PROJECT_ID}/${HASH_A}.jpg`)
    expect(await listProjectSets(db, FIXTURE_PROJECT_ID)).toEqual([])
  })

  it('an upload is refused past six plates', async () => {
    const id = await addTradingFloor()
    for (const letter of ['1', '2', '3', '4', '5', '6']) {
      const done = await finaliseSetPlateAction({
        setId: id,
        mimeType: 'image/png',
        contentHash: letter.repeat(64),
        width: 10,
        height: 10,
        view: 'other',
      })
      expect(done.ok).toBe(true)
    }
    const seventh = await createSetPlateUploadAction({
      setId: id,
      mimeType: 'image/png',
      fileSize: 10,
      contentHash: '7'.repeat(64),
    })
    expect(seventh.ok).toBe(false)
    expect(seventh.error).toMatch(/at most 6 plates/)
  })

  it('an upload is refused for a MIME type the image models do not take', async () => {
    const id = await addTradingFloor()
    const gif = await createSetPlateUploadAction({
      setId: id,
      mimeType: 'image/gif',
      fileSize: 1000,
      contentHash: HASH_B,
    })
    expect(gif.ok).toBe(false)
    expect(gif.error).toMatch(/JPEG, PNG or WebP/)
  })

  it('an upload is refused past fifteen megabytes', async () => {
    const id = await addTradingFloor()
    const tooBig = await createSetPlateUploadAction({
      setId: id,
      mimeType: 'image/jpeg',
      fileSize: 16 * 1024 * 1024,
      contentHash: HASH_A,
    })
    expect(tooBig.ok).toBe(false)
    expect(tooBig.error).toMatch(/15 MB/)
  })

  it('finalising stores the plate with origin "uploaded" and dedupes on content hash', async () => {
    const id = await addTradingFloor()
    const done = await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 1200,
      height: 1600,
      view: 'north',
    })
    expect(done).toEqual({ ok: true })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates).toHaveLength(1)
    expect(set?.plates[0]).toMatchObject({
      origin: 'uploaded',
      view: 'north',
      width: 1200,
      height: 1600,
    })

    // The same fingerprint again is a no-op, not a second plate.
    const again = await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 1200,
      height: 1600,
      view: 'detail',
    })
    expect(again).toEqual({ ok: true })
    const [after] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(after?.plates).toHaveLength(1)
  })

  it('a plate added from a web address stores its source URL', async () => {
    const id = await addTradingFloor()
    expect(
      await addSetPlateFromUrlAction({
        setId: id,
        url: 'https://example.com/trading-floor.jpg',
        view: 'north',
      }),
    ).toEqual({ ok: true })

    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates).toHaveLength(1)
    expect(set?.plates[0]).toMatchObject({
      origin: 'uploaded',
      view: 'north',
      width: 1200,
      height: 1600,
      mimeType: 'image/jpeg',
      sourceUrl: 'https://example.com/trading-floor.jpg',
    })
    expect(set?.plates[0]?.r2Key).toMatch(/^boom-busters\/sets\/[0-9A-Z]{26}\/[0-9a-f]{64}\.jpg$/)
  })

  it('removes a plate from storage and the row', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
      view: 'north',
    })
    expect(await removeSetPlateAction({ setId: id, contentHash: HASH_A })).toEqual({ ok: true })
    expect(storage.deleted).toContain(`boom-busters/sets/${FIXTURE_PROJECT_ID}/${HASH_A}.jpg`)
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates).toEqual([])
  })

  it('generating a plate returns candidates and spends nothing in mock mode', async () => {
    const id = await addTradingFloor()
    const result = await generateSetPlateAction(id)
    expect(result.ok).toBe(true)
    expect(result.candidates?.length).toBeGreaterThan(0)
    // Mock mode never leaves the process: every candidate is a self-contained
    // data: thumbnail, never a fetched or billed asset.
    for (const candidate of result.candidates ?? []) {
      expect(candidate.sourceUrl.startsWith('data:')).toBe(true)
    }
  })

  it('refuses to generate for a set that already holds six plates, before spending', async () => {
    const id = await addTradingFloor()
    for (const letter of ['1', '2', '3', '4', '5', '6']) {
      expect(
        await finaliseSetPlateAction({
          setId: id,
          mimeType: 'image/png',
          contentHash: letter.repeat(64),
          width: 10,
          height: 10,
          view: 'other',
        }),
      ).toEqual({ ok: true })
    }
    generate.mockClear()

    const result = await generateSetPlateAction(id)
    expect(result).toEqual({
      ok: false,
      error: 'A set keeps at most 6 plates; remove one first.',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('generates the first plate from the look alone, as an empty north view', async () => {
    const id = await addTradingFloor()
    generate.mockClear()
    await generateSetPlateAction(id)
    const request = generate.mock.calls[0]?.[0]
    expect(request?.prompt).toContain(
      'The trading floor, empty of people: a wide establishing photograph of the whole room, ' +
        'taken from its entrance at eye level',
    )
    expect(request?.negativePrompt).toBe('people, figures')
    // Nothing to condition on yet.
    expect(request?.references ?? []).toEqual([])
  })

  // Decision 273, directions from 275: a set with one plate gave every still
  // one viewpoint to copy.
  it('generates another view conditioned on the plates the set holds', async () => {
    const id = await addTradingFloor()
    expect(
      await finaliseSetPlateAction({
        setId: id,
        mimeType: 'image/png',
        contentHash: HASH_A,
        width: 10,
        height: 10,
        view: 'north',
      }),
    ).toEqual({ ok: true })
    generate.mockClear()

    const result = await generateSetPlateAction(id, 'south')
    expect(result.ok).toBe(true)
    const request = generate.mock.calls[0]?.[0]
    expect((request?.references ?? []).map((reference) => reference.kind)).toEqual(['object'])
    expect(request?.prompt).toContain('a wide photograph of the whole room facing south')
    // The closing declaration asks for a new photograph, not the plate's framing.
    expect(request?.prompt).toContain('never reproduce or edit the framing of its photographs')
  })

  it('refuses another view before the set has a plate, before spending', async () => {
    const id = await addTradingFloor()
    generate.mockClear()
    expect(await generateSetPlateAction(id, 'east')).toEqual({
      ok: false,
      error: 'Another view needs a plate to work from. Add or generate the first one.',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('records a chosen plate under the view it was generated for', async () => {
    const id = await addTradingFloor()
    const generated = await generateSetPlateAction(id)
    const candidate = generated.candidates![0]!
    expect(
      await chooseSetPlateAction({
        setId: id,
        r2Key: candidate.r2Key ?? null,
        sourceUrl: candidate.sourceUrl,
        width: candidate.width!,
        height: candidate.height!,
        view: 'other',
      }),
    ).toEqual({ ok: true })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates[0]?.view).toBe('other')
  })

  it('choosing a generated plate stores it with origin "generated"', async () => {
    const id = await addTradingFloor()
    const generated = await generateSetPlateAction(id)
    const candidate = generated.candidates?.[0]
    expect(candidate?.sourceUrl).toBeDefined()
    expect(candidate?.width).toBeDefined()
    expect(candidate?.height).toBeDefined()

    expect(
      await chooseSetPlateAction({
        setId: id,
        r2Key: candidate?.r2Key ?? null,
        sourceUrl: candidate!.sourceUrl,
        width: candidate!.width!,
        height: candidate!.height!,
      }),
    ).toEqual({ ok: true })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates).toHaveLength(1)
    expect(set?.plates[0]).toMatchObject({
      origin: 'generated',
      view: 'north',
      width: candidate!.width,
      height: candidate!.height,
      mimeType: 'image/png',
    })
  })

  it('refuses a candidate key from outside this project’s own stills', async () => {
    // The key is the client's to name, so an arbitrary one would make this
    // action a reader of any object in the bucket.
    const id = await addTradingFloor()
    const result = await chooseSetPlateAction({
      setId: id,
      r2Key: 'boom-busters/stills/some-other-project/deadbeef.png',
      sourceUrl: 'generated://gemini/deadbeef',
      width: 1344,
      height: 768,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available/)
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates ?? []).toEqual([])
  })

  it('choosing a plate already in R2 copies it by r2Key, not by fetching a URL', async () => {
    const id = await addTradingFloor()
    // The mock storage's getObjectBytes always answers [1, 2, 3]; the stored
    // plate's r2Key is a setPlateKey of THAT content's hash, proving the
    // bytes came from getObjectBytes(r2Key) rather than from sourceUrl.
    const expectedHash = createHash('sha256')
      .update(Buffer.from([1, 2, 3]))
      .digest('hex')

    expect(
      await chooseSetPlateAction({
        setId: id,
        r2Key: `boom-busters/stills/${FIXTURE_PROJECT_ID}/deadbeef.png`,
        sourceUrl: 'generated://gemini/deadbeef',
        width: 1344,
        height: 768,
      }),
    ).toEqual({ ok: true })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates).toHaveLength(1)
    expect(set?.plates[0]).toMatchObject({
      r2Key: `boom-busters/sets/${FIXTURE_PROJECT_ID}/${expectedHash}.png`,
      origin: 'generated',
      view: 'north',
      width: 1344,
      height: 768,
      mimeType: 'image/png',
    })
  })

  it('refuses a candidate with no r2Key and a non-data sourceUrl rather than fetch it', async () => {
    const id = await addTradingFloor()
    const result = await chooseSetPlateAction({
      setId: id,
      r2Key: null,
      sourceUrl: 'https://attacker.example/whatever.png',
      width: 1344,
      height: 768,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no longer available/)
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.plates ?? []).toEqual([])
  })

  it('every action refuses a caller who is not the owner', async () => {
    const id = await addTradingFloor()
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(updateSetAction(id, { name: 'x' })).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(addSetAction(FIXTURE_PROJECT_ID, { name: 'x', look: 'y' })).rejects.toThrow(
      'Not signed in',
    )
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(removeSetAction(id)).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(
      createSetPlateUploadAction({
        setId: id,
        mimeType: 'image/jpeg',
        fileSize: 10,
        contentHash: HASH_A,
      }),
    ).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(
      finaliseSetPlateAction({
        setId: id,
        mimeType: 'image/jpeg',
        contentHash: HASH_A,
        width: 10,
        height: 10,
        view: 'other',
      }),
    ).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(
      addSetPlateFromUrlAction({ setId: id, url: 'https://example.com/x.jpg', view: 'other' }),
    ).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(removeSetPlateAction({ setId: id, contentHash: HASH_A })).rejects.toThrow(
      'Not signed in',
    )
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(generateSetPlateAction(id)).rejects.toThrow('Not signed in')
    authMock.auth.mockResolvedValueOnce(null as never)
    await expect(
      chooseSetPlateAction({
        setId: id,
        r2Key: null,
        sourceUrl: 'data:image/png;base64,AA==',
        width: 10,
        height: 10,
      }),
    ).rejects.toThrow('Not signed in')
  })

  it('says so when storage is not configured', async () => {
    const id = await addTradingFloor()
    storage.configured = false
    const result = await createSetPlateUploadAction({
      setId: id,
      mimeType: 'image/jpeg',
      fileSize: 10,
      contentHash: HASH_A,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/R2 configured/)
  })

  it('drafts the room inventory when the first plate lands, and never overwrites it', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
    })
    let [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe(MOCK_LAYOUT)

    await updateSetAction(id, { layout: 'North wall: my own words' })
    await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_B,
      width: 10,
      height: 10,
    })
    ;[set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe('North wall: my own words')
  })

  it('redrafts the inventory on request, replacing the owner’s edits', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({
      setId: id,
      mimeType: 'image/jpeg',
      contentHash: HASH_A,
      width: 10,
      height: 10,
    })
    await updateSetAction(id, { layout: 'North wall: my own words' })
    expect(await redraftSetLayoutAction(id)).toEqual({ ok: true, layout: MOCK_LAYOUT })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe(MOCK_LAYOUT)
  })

  it('refuses to redraft a set with no plate', async () => {
    const id = await addTradingFloor()
    expect(await redraftSetLayoutAction(id)).toEqual({
      ok: false,
      error: 'Add a plate first; the inventory is drafted from it.',
    })
  })
})

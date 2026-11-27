// @vitest-environment node

import {
  costLedger,
  deleteCastMember,
  dismissCastMember,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getChannelSettings,
  getProject,
  getPublishRecord,
  getThumbnailPackage,
  insertCastMember,
  listThumbnailPackages,
  mergePublishMetadata,
  replaceUnapprovedGenerated,
  requireTestDatabase,
  seed,
  setCastPhotos,
  thumbnailPackages,
  channels,
  publishRecords,
} from '@boom-busters/db'
import {
  BudgetExceededError,
  ContentPolicyError,
  FIRST_CHANNEL_ID,
  newId,
} from '@boom-busters/schemas'
import type { ImageGenRequest } from '@boom-busters/providers'
import type { PlannedPackage, ThumbnailIdea } from '@boom-busters/schemas'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import type * as DbModule from '@boom-busters/db'
import type * as Answer from '@/lib/answer'
import type * as Catalogue from '@/lib/model-catalogue'
import type * as Cost from '@boom-busters/cost'

/**
 * The thumbnail set against the real database in mock-provider mode, with the
 * image adapter, the planner call and the film's grounding replaced.
 */

// The channel's recorded tests are shared state; a test sets what the planner is told by
// replacing the two readers, and the real ones answer when nothing is set.
const tests = vi.hoisted(() => ({
  results: null as { idea: string; tests: number; wins: number }[] | null,
  finished: null as { withWinner: number; same: number; inconclusive: number } | null,
  // A film's slots and the stored visual keys, replaced only by the tests that need them.
  slots: null as Awaited<ReturnType<typeof DbModule.listShotSlots>> | null,
  keys: null as { google: string } | null,
}))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    listShotSlots: (...args: Parameters<typeof actual.listShotSlots>) =>
      tests.slots ? Promise.resolve(tests.slots) : actual.listShotSlots(...args),
    visualCredentials: (...args: Parameters<typeof actual.visualCredentials>) =>
      tests.keys ? Promise.resolve(tests.keys) : actual.visualCredentials(...args),
    ideaResults: (...args: Parameters<typeof actual.ideaResults>) =>
      tests.results ? Promise.resolve(tests.results) : actual.ideaResults(...args),
    finishedTests: (...args: Parameters<typeof actual.finishedTests>) =>
      tests.finished ? Promise.resolve(tests.finished) : actual.finishedTests(...args),
  }
})

const answer = vi.hoisted(() => ({ callForAnswer: vi.fn() }))
vi.mock('@/lib/answer', async (importOriginal) => ({
  ...(await importOriginal<typeof Answer>()),
  callForAnswer: answer.callForAnswer,
}))

const grounding = vi.hoisted(() => ({
  metadataGrounding: vi.fn(),
  titleFrameFor: vi.fn(async () => null),
}))
vi.mock('@/lib/publish-grounding', () => grounding)

vi.mock('@/lib/publish-review', () => ({
  descriptionIngredients: vi.fn(async () => ({ hook: 'It began with a number.' })),
}))
vi.mock('@/inngest/lib/channel', () => ({ requireCompleteBible: <T>(inUse: T): T => inUse }))

const adapter = vi.hoisted(() => ({
  generate: vi.fn(),
  styles: 3,
}))
vi.mock('@/lib/model-catalogue', async (importOriginal) => {
  const actual = await importOriginal<typeof Catalogue>()
  return {
    ...actual,
    stillCatalogue: async (...args: Parameters<typeof actual.stillCatalogue>) => {
      const catalogue = await actual.stillCatalogue(...args)
      return {
        ...catalogue,
        google: {
          ...catalogue.google,
          referenceLimits: () => ({ characters: 3, objects: 3, styles: adapter.styles }),
        },
      }
    },
    stillGenerator: () => ({ id: 'google', generate: adapter.generate }),
  }
})

const compose = vi.hoisted(() => ({ composeThumbnail: vi.fn() }))
vi.mock('@/lib/thumbnail-compose', () => compose)

const storage = vi.hoisted(() => ({
  configured: false,
  put: vi.fn(async (_key: string): Promise<undefined> => undefined),
  delete: vi.fn(async (_key: string): Promise<undefined> => undefined),
  // Stored objects' sizes in bytes; a key not listed is four bytes.
  sizes: new Map<string, number>(),
}))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getObjectBytes: async (key: string) => ({
    bytes: new Uint8Array(storage.sizes.get(key) ?? 4),
    contentType: 'image/png',
  }),
  storageConfigured: () => storage.configured,
  presignGet: async (key: string) => `https://signed.test/${key}`,
  putObject: (key: string) => storage.put(key),
  deleteObject: (key: string) => storage.delete(key),
}))

const cost = vi.hoisted(() => ({ refuse: false }))
vi.mock('@boom-busters/cost', async (importOriginal) => {
  const actual = await importOriginal<typeof Cost>()
  return {
    ...actual,
    withCost: ((...args: Parameters<typeof actual.withCost>) => {
      if (cost.refuse) {
        cost.refuse = false
        throw new BudgetExceededError({
          provider: 'google',
          operation: 'image.generate',
          budgetUsd: 10,
          monthSpendUsd: 10,
          estimateUsd: 0.15,
        })
      }
      return actual.withCost(...args)
    }) as typeof actual.withCost,
  }
})

import {
  CHANGE_IMAGES_MAX_BYTES,
  composeThumbnailPackage,
  paintThumbnailPicture,
  planThumbnailSet,
  thumbnailSetEstimateUsd,
} from './thumbnail-set'

/** The settings merge does not carry `thumbnails` yet, so the row is written directly. */
async function setThumbnailSettings(
  thumbnails: Awaited<ReturnType<typeof getChannelSettings>>['thumbnails'],
): Promise<void> {
  const settings = await getChannelSettings(db, FIRST_CHANNEL_ID)
  await db
    .update(channels)
    .set({ settings: { ...settings, thumbnails } })
    .where(eq(channels.id, FIRST_CHANNEL_ID))
}

const describeDb = requireTestDatabase() ? describe : describe.skip

const planned = (idea: ThumbnailIdea, over: Partial<PlannedPackage> = {}): PlannedPackage => ({
  idea,
  angle: `The ${idea} angle.`,
  title: `The ${idea} title`,
  headline: `The ${idea}`,
  picture: { subject: `a ${idea}`, framing: '', textSide: 'left', stillSlotIds: [], depicts: [] },
  claimIds: ['c1'],
  ...over,
})

const CLAIMS = [
  { id: 'c1', text: 'The audit found a gap.', sourceUrl: null, confidence: 'sourced' },
]

const png = 'data:image/png;base64,iVBORw0KGgo='
const image = { url: png, width: 2048, height: 1152 }

describeDb('thumbnail set (mock mode)', () => {
  let recordId = ''
  let originalThumbnails: Awaited<ReturnType<typeof getChannelSettings>>['thumbnails']

  const setNote = async (note: string | undefined) => {
    const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
    const { thumbnailSetNote: _old, ...rest } = record.metadata as Record<string, unknown>
    await db
      .update(publishRecords)
      .set({ metadata: note === undefined ? rest : { ...rest, thumbnailSetNote: note } })
      .where(eq(publishRecords.id, record.id))
  }
  const noteOf = async (): Promise<unknown> =>
    (
      (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata as Record<
        string,
        unknown
      >
    )['thumbnailSetNote']

  const thumbnailLedger = async () =>
    db
      .select()
      .from(costLedger)
      .where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    vi.clearAllMocks()
    adapter.styles = 3
    cost.refuse = false
    storage.configured = false
    storage.sizes.clear()
    adapter.generate.mockImplementation(async () => ({ images: [image], estimatedCostUsd: 0.15 }))
    grounding.metadataGrounding.mockResolvedValue({
      claims: CLAIMS,
      centralQuestion: undefined,
      scriptVersion: 1,
    })
    await seed(db)
    originalThumbnails = (await getChannelSettings(db, FIRST_CHANNEL_ID)).thumbnails
    const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    recordId = record.id
    await db.delete(thumbnailPackages).where(eq(thumbnailPackages.publishRecordId, recordId))
    await db
      .update(publishRecords)
      .set({ uploadedThumbKeys: [] })
      .where(eq(publishRecords.id, recordId))
    await db.delete(costLedger).where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    tests.results = null
    tests.finished = null
    tests.slots = null
    tests.keys = null
    await db.delete(thumbnailPackages).where(eq(thumbnailPackages.publishRecordId, recordId))
    await setThumbnailSettings(originalThumbnails)
    await db.delete(costLedger).where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)
    await setNote(undefined)
  })

  it("estimates three images at the routed model's 2K price", async () => {
    expect(await thumbnailSetEstimateUsd(FIRST_CHANNEL_ID, 3)).toBeCloseTo(0.45, 4)
  })

  describe('planning', () => {
    beforeEach(() => {
      vi.stubEnv('MOCK_PROVIDERS', '0')
    })

    it('plans only the free places and tells the planner the held ideas', async () => {
      await db.insert(thumbnailPackages).values({
        publishRecordId: recordId,
        position: 0,
        source: 'generated',
        state: 'ready',
        idea: 'figure',
        title: 'Kept',
        composedKey: 'boom-busters/thumbs/x/kept.jpg',
        approvedAt: new Date(),
      })
      answer.callForAnswer.mockResolvedValue({
        ok: true,
        value: [planned('object'), planned('moment')],
        calls: 1,
      })

      const result = await planThumbnailSet({
        projectId: FIXTURE_PROJECT_ID,
        publishRecordId: recordId,
      })

      expect(result.inserted).toHaveLength(2)
      const system = answer.callForAnswer.mock.calls[0]![0].request.system as string
      expect(system).toContain('Return exactly 2 packages.')
      expect(system).toContain('never plan these again: figure.')
      const rows = await listThumbnailPackages(db, recordId)
      expect(rows.map((row) => row.idea)).toEqual(['figure', 'object', 'moment'])
      expect(rows.map((row) => row.id).slice(1)).toEqual(result.inserted)
      expect(rows.slice(1).every((row) => row.state === 'planned')).toBe(true)
    })

    it('tells the planner what has won only when there is something to tell', async () => {
      const pastOf = (call: number): string | undefined =>
        (answer.callForAnswer.mock.calls[call]![0].request.messages as { content: string }[]).find(
          (message) => message.content.startsWith('Past results:'),
        )?.content
      answer.callForAnswer.mockResolvedValue({
        ok: true,
        value: [planned('object'), planned('moment'), planned('figure')],
        calls: 1,
      })
      const plan = () =>
        planThumbnailSet({ projectId: FIXTURE_PROJECT_ID, publishRecordId: recordId })
      tests.results = [
        { idea: 'person', tests: 4, wins: 3 },
        { idea: 'figure', tests: 2, wins: 0 },
        { idea: 'object', tests: 0, wins: 0 },
        { idea: 'moment', tests: 0, wins: 0 },
        { idea: 'contrast', tests: 0, wins: 0 },
      ]

      // Four tests with a winner: nothing to say yet.
      tests.finished = { withWinner: 4, same: 3, inconclusive: 1 }
      await plan()
      expect(pastOf(0)).toBeUndefined()

      // Five: the sentences, and nothing about the tests that ended the same.
      tests.finished = { withWinner: 5, same: 3, inconclusive: 1 }
      await plan()
      expect(pastOf(1)).toBe('Past results:\nPerson: won 3 of 4 tests. Figure: won 0 of 2 tests.')
    })

    it('asks once more when a package is dropped, never twice', async () => {
      answer.callForAnswer
        .mockResolvedValueOnce({
          ok: true,
          value: [planned('object'), planned('object'), planned('moment')],
          calls: 1,
        })
        // The second answer repeats a held idea, so it is dropped too.
        .mockResolvedValueOnce({ ok: true, value: [planned('object')], calls: 1 })

      const result = await planThumbnailSet({
        projectId: FIXTURE_PROJECT_ID,
        publishRecordId: recordId,
      })

      expect(answer.callForAnswer).toHaveBeenCalledTimes(2)
      const second = answer.callForAnswer.mock.calls[1]![0].request.system as string
      expect(second).toContain('Return exactly 1 packages.')
      expect(second).toContain('never plan these again: object, moment.')
      expect(result.inserted).toHaveLength(2)
      expect(result.dropped.map((drop) => drop.reason)).toEqual([
        'The object idea is already in the set.',
        'The object idea is already in the set.',
      ])
    })

    it('plans in mock mode on a project with no claims', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '1')
      // The synthetic claim's text is the project's title, so a title with a
      // figure is what lets a figure headline plan. The seeded fixture has one.
      expect((await getProject(db, FIXTURE_PROJECT_ID))!.title).toMatch(/\d/)
      grounding.metadataGrounding.mockResolvedValue({
        claims: [],
        centralQuestion: undefined,
        scriptVersion: 0,
      })

      const result = await planThumbnailSet({
        projectId: FIXTURE_PROJECT_ID,
        publishRecordId: recordId,
      })

      expect(answer.callForAnswer).not.toHaveBeenCalled()
      expect(result.inserted).toHaveLength(3)
      const rows = await listThumbnailPackages(db, recordId)
      expect(rows.every((row) => row.claimIds.join() === 'mock-claim')).toBe(true)
    })

    it('a finished plan clears the claim', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '1')
      grounding.metadataGrounding.mockResolvedValue({
        claims: [],
        centralQuestion: undefined,
        scriptVersion: 0,
      })
      await mergePublishMetadata(db, recordId, {
        thumbnailSetRequestedAt: new Date().toISOString(),
        title: 'Kept',
      })

      await planThumbnailSet({ projectId: FIXTURE_PROJECT_ID, publishRecordId: recordId })

      const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
      expect(metadata['thumbnailSetRequestedAt']).toBeUndefined()
      expect(metadata['title']).toBe('Kept')
    })

    it('a plan that cannot be made clears the claim', async () => {
      await mergePublishMetadata(db, recordId, {
        thumbnailSetRequestedAt: new Date().toISOString(),
      })
      answer.callForAnswer.mockResolvedValue({ ok: false, issue: 'The answer was not JSON.' })

      await expect(
        planThumbnailSet({ projectId: FIXTURE_PROJECT_ID, publishRecordId: recordId }),
      ).rejects.toThrow('The set could not be planned')

      const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
      expect(metadata['thumbnailSetRequestedAt']).toBeUndefined()
    })

    it('a vet that keeps nothing leaves the old packages and says why', async () => {
      const { inserted } = await replaceUnapprovedGenerated(db, recordId, [planned('figure')])
      await db
        .update(thumbnailPackages)
        .set({ pictureKey: 'boom-busters/thumbs/x/art-old.png', state: 'ready' })
        .where(eq(thumbnailPackages.id, inserted[0]!.id))
      const bad = planned('object', { claimIds: ['zzz'] })
      answer.callForAnswer.mockResolvedValue({ ok: true, value: [bad], calls: 1 })
      const sentence =
        'The set could not be planned: Object: Claim zzz is not a verified claim of this film. ' +
        'Object: Claim zzz is not a verified claim of this film.'

      await expect(
        planThumbnailSet({ projectId: FIXTURE_PROJECT_ID, publishRecordId: recordId }),
      ).rejects.toThrow(sentence)

      const rows = await listThumbnailPackages(db, recordId)
      expect(rows.map((row) => row.id)).toEqual([inserted[0]!.id])
      expect(rows[0]!.pictureKey).toBe('boom-busters/thumbs/x/art-old.png')
      expect(await noteOf()).toBe(sentence)
    })

    it('a partial plan says what was dropped', async () => {
      answer.callForAnswer
        .mockResolvedValueOnce({
          ok: true,
          value: [
            planned('object'),
            planned('figure', { claimIds: ['zzz'] }),
            planned('moment', { headline: 'One two three four five' }),
          ],
          calls: 1,
        })
        .mockResolvedValueOnce({ ok: true, value: [], calls: 1 })

      const result = await planThumbnailSet({
        projectId: FIXTURE_PROJECT_ID,
        publishRecordId: recordId,
      })

      expect(result.inserted).toHaveLength(1)
      expect(await noteOf()).toBe(
        'Planned 1 of 3. Figure: Claim zzz is not a verified claim of this film. ' +
          'Moment: The headline is longer than 4 words.',
      )
    })

    it('a clean plan clears the note', async () => {
      await setNote('Planned 1 of 3. Figure: something old.')
      answer.callForAnswer.mockResolvedValue({
        ok: true,
        value: [planned('object'), planned('moment'), planned('figure')],
        calls: 1,
      })

      const result = await planThumbnailSet({
        projectId: FIXTURE_PROJECT_ID,
        publishRecordId: recordId,
      })

      expect(result.inserted).toHaveLength(3)
      expect(await noteOf()).toBe('')
    })

    it('an unusable planner answer says why and plans nothing', async () => {
      answer.callForAnswer.mockResolvedValue({
        ok: false,
        issue: 'The answer was not a list of packages.',
        calls: 2,
      })

      await expect(
        planThumbnailSet({ projectId: FIXTURE_PROJECT_ID, publishRecordId: recordId }),
      ).rejects.toThrow('The set could not be planned: The answer was not a list of packages.')

      expect(await listThumbnailPackages(db, recordId)).toEqual([])
      expect(await noteOf()).toBe(
        'The set could not be planned: The answer was not a list of packages.',
      )
    })
  })

  describe('painting', () => {
    let ids: string[] = []

    beforeEach(async () => {
      const { inserted } = await replaceUnapprovedGenerated(db, recordId, [
        planned('figure'),
        planned('object'),
        planned('moment'),
      ])
      ids = inserted.map((row) => row.id)
    })

    const requestOf = (call: number): ImageGenRequest =>
      adapter.generate.mock.calls[call]![0] as ImageGenRequest

    it('sends style references only to a model that takes them', async () => {
      await setThumbnailSettings({
        styleNote: '',
        markPlacement: 'tl',
        references: [
          {
            id: newId(),
            r2Key: 'boom-busters/thumb-refs/x/a.png',
            mimeType: 'image/png',
            note: 'Hard side light',
            inUse: true,
          },
        ],
      })

      adapter.styles = 0
      await paintThumbnailPicture(ids[0]!)
      expect(requestOf(0).references ?? []).toEqual([])

      adapter.styles = 3
      await paintThumbnailPicture(ids[1]!)
      expect(requestOf(1).references?.map((reference) => reference.kind)).toEqual(['style'])
      expect(requestOf(1).size).toBe('2K')
      expect(requestOf(1).count).toBe(1)
    })

    it('names every depicted person in the picture prompt', async () => {
      const shown = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Test Person One',
        role: 'Founder',
      })
      const unseen = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Test Person Two',
        role: 'Auditor',
      })
      try {
        await setCastPhotos(db, shown.id, [
          {
            r2Key: 'boom-busters/cast/x/one.jpg',
            contentHash: 'one',
            mimeType: 'image/jpeg',
            width: 100,
            height: 100,
            view: 'front',
          },
        ])
        await db
          .update(thumbnailPackages)
          .set({
            picture: {
              ...planned('figure').picture,
              depicts: ['Test Person One', 'Test Person Two'],
            },
          })
          .where(eq(thumbnailPackages.id, ids[0]!))

        await paintThumbnailPicture(ids[0]!)

        const request = requestOf(0)
        expect(request.prompt).toContain('Test Person One')
        expect(request.prompt).toContain('Test Person Two')
        expect(request.prompt).toContain('1 portrait of Test Person One')
        expect(request.references?.map((reference) => reference.name)).toEqual(['Test Person One'])
      } finally {
        await deleteCastMember(db, shown.id)
        await deleteCastMember(db, unseen.id)
      }
    })

    it('a refused picture fails its own package only', async () => {
      adapter.generate
        .mockImplementationOnce(async () => ({ images: [image], estimatedCostUsd: 0.15 }))
        .mockImplementationOnce(async () => {
          throw new ContentPolicyError('google', 'the picture was refused')
        })
        .mockImplementationOnce(async () => ({ images: [image], estimatedCostUsd: 0.15 }))

      for (const id of ids) await paintThumbnailPicture(id)

      const rows = await listThumbnailPackages(db, recordId)
      expect(rows.map((row) => row.state)).toEqual(['painting', 'failed', 'painting'])
      expect(rows[1]!.error).toBe('google: the picture was refused')
      expect(rows[0]!.pictureKey).toContain(`/thumbs/${FIXTURE_PROJECT_ID}/art-`)
      expect(rows[1]!.pictureKey).toBeNull()
      // The refused image left nothing in the ledger: two settled rows, not three.
      const ledger = await thumbnailLedger()
      expect(ledger).toHaveLength(2)
      expect(ledger.every((entry) => entry.actualUsd !== null)).toBe(true)
    })

    it('a painted package stays painting until it is composed', async () => {
      await paintThumbnailPicture(ids[0]!)

      const painted = await getThumbnailPackage(db, ids[0]!)
      expect(painted?.state).toBe('painting')
      expect(painted?.pictureKey).toContain(`/thumbs/${FIXTURE_PROJECT_ID}/art-`)
      expect(painted?.composedKey).toBeNull()

      await composeThumbnailPackage(ids[0]!)

      const composed = await getThumbnailPackage(db, ids[0]!)
      expect(composed?.state).toBe('ready')
      expect(composed?.composedKey).toBe(
        `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/mock-${ids[0]}.jpg`,
      )
    })

    it('a repaint is not ready until its new compose lands', async () => {
      const oldComposite = 'boom-busters/thumbs/x/old.jpg'
      await db
        .update(thumbnailPackages)
        .set({
          pictureKey: 'boom-busters/thumbs/x/art-old.png',
          composedKey: oldComposite,
          state: 'ready',
        })
        .where(eq(thumbnailPackages.id, ids[0]!))

      await paintThumbnailPicture(ids[0]!)

      const repainted = await getThumbnailPackage(db, ids[0]!)
      expect(repainted?.state).toBe('painting')
      expect(repainted?.pictureKey).not.toBe('boom-busters/thumbs/x/art-old.png')
      expect(repainted?.composedKey).toBe(oldComposite)

      await composeThumbnailPackage(ids[0]!)

      expect((await getThumbnailPackage(db, ids[0]!))?.state).toBe('ready')
    })

    describe("an owner's brief", () => {
      const portrait = {
        r2Key: 'boom-busters/cast/x/one.jpg',
        contentHash: 'one',
        mimeType: 'image/jpeg' as const,
        width: 100,
        height: 100,
        view: 'front' as const,
      }

      /** Someone the producer removed from the cast; the returned function deletes the row. */
      const removedPerson = async (name: string) => {
        const member = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name,
          role: 'Witness',
        })
        await dismissCastMember(db, member.id)
        return () => deleteCastMember(db, member.id)
      }

      it("an owner's brief sends portraits and style references and no stills", async () => {
        const shown = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name: 'Test Person One',
          role: 'Founder',
        })
        try {
          await setCastPhotos(db, shown.id, [portrait])
          await setThumbnailSettings({
            styleNote: '',
            markPlacement: 'tl',
            references: [
              {
                id: newId(),
                r2Key: 'boom-busters/thumb-refs/x/a.png',
                mimeType: 'image/png',
                note: 'Hard side light',
                inUse: true,
              },
            ],
          })
          // The film has a chosen still; the owner's brief names none.
          tests.slots = [
            {
              id: 'slot-1',
              type: 'still',
              brief: {
                type: 'still',
                coversText: 'x',
                description: 'A boardroom',
                motion: { kind: 'static' },
                transition: 'cut',
                prompt: 'a boardroom',
              },
              candidates: [
                {
                  id: 'c',
                  provider: 'pexels',
                  kind: 'image',
                  sourceUrl: 'https://x.test/a.png',
                  r2Key: 'boom-busters/stills/x/a.png',
                  licence: 'test',
                  chosen: true,
                },
              ],
            },
          ] as unknown as typeof tests.slots
          await db
            .update(thumbnailPackages)
            .set({
              picture: {
                subject: 'Test Person One barefoot on a glass office floor',
                framing: '',
                textSide: 'left',
                stillSlotIds: [],
                depicts: ['Test Person One'],
              },
            })
            .where(eq(thumbnailPackages.id, ids[0]!))

          await paintThumbnailPicture(ids[0]!)

          const request = requestOf(0)
          expect(request.references?.map((reference) => reference.kind)).toEqual([
            'character',
            'style',
          ])
          expect(request.prompt).toContain('Test Person One barefoot on a glass office floor.')
          expect(request.prompt).not.toContain('film still')
        } finally {
          await deleteCastMember(db, shown.id)
        }
      })

      it('a brief naming someone removed from the cast is not bought', async () => {
        const remove = await removedPerson('Zelda Quillfeather')
        try {
          await db
            .update(thumbnailPackages)
            .set({
              pictureKey: 'boom-busters/thumbs/x/art-old.png',
              composedKey: 'boom-busters/thumbs/x/old.jpg',
              state: 'ready',
              picture: {
                ...planned('figure').picture,
                subject: 'A ledger on a desk',
                framing: 'zelda  quillfeather in the doorway',
              },
            })
            .where(eq(thumbnailPackages.id, ids[0]!))

          await paintThumbnailPicture(ids[0]!)

          expect(adapter.generate).not.toHaveBeenCalled()
          expect(await thumbnailLedger()).toHaveLength(0)
          expect(await getThumbnailPackage(db, ids[0]!)).toMatchObject({
            state: 'failed',
            error: 'Zelda Quillfeather was removed from the cast.',
            pictureKey: 'boom-busters/thumbs/x/art-old.png',
            previousPictureKey: null,
          })
        } finally {
          await remove()
        }
      })

      it('a change does not read the brief', async () => {
        const remove = await removedPerson('Zelda Quillfeather')
        try {
          const old = 'boom-busters/thumbs/x/art-old.png'
          await db
            .update(thumbnailPackages)
            .set({
              pictureKey: old,
              composedKey: 'boom-busters/thumbs/x/old.jpg',
              state: 'ready',
              picture: { ...planned('figure').picture, subject: 'Zelda Quillfeather at a desk' },
            })
            .where(eq(thumbnailPackages.id, ids[0]!))

          await paintThumbnailPicture(ids[0]!, { baseKey: old, note: 'darker sky' })

          expect(adapter.generate).toHaveBeenCalledTimes(1)
          expect((await getThumbnailPackage(db, ids[0]!))?.state).toBe('painting')
        } finally {
          await remove()
        }
      })
    })

    describe('changing a picture', () => {
      const OLD = 'boom-busters/thumbs/x/art-old.png'
      const OLD_COMPOSITE = 'boom-busters/thumbs/x/old.jpg'

      /** A package holding a picture and a composite, ready to be changed. */
      const withPicture = async (over: Partial<typeof thumbnailPackages.$inferInsert> = {}) =>
        db
          .update(thumbnailPackages)
          .set({ pictureKey: OLD, composedKey: OLD_COMPOSITE, state: 'ready', ...over })
          .where(eq(thumbnailPackages.id, ids[0]!))

      const portrait = (key: string) => ({
        r2Key: key,
        contentHash: key,
        mimeType: 'image/jpeg' as const,
        width: 100,
        height: 100,
        view: 'front' as const,
      })

      /** Two cast members with one portrait each, both depicted by the first package. */
      const withCast = async (portraits: [string, string]) => {
        const one = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name: 'Test Person One',
          role: 'Founder',
        })
        const two = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name: 'Test Person Two',
          role: 'Auditor',
        })
        await setCastPhotos(db, one.id, [portrait(portraits[0])])
        await setCastPhotos(db, two.id, [portrait(portraits[1])])
        await db
          .update(thumbnailPackages)
          .set({
            picture: {
              ...planned('figure').picture,
              depicts: ['Test Person One', 'Test Person Two'],
            },
          })
          .where(eq(thumbnailPackages.id, ids[0]!))
        return async () => {
          await deleteCastMember(db, one.id)
          await deleteCastMember(db, two.id)
        }
      }

      it('a change sends the picture and the portraits, and no stills or styles', async () => {
        const removeCast = await withCast([
          'boom-busters/cast/x/one.jpg',
          'boom-busters/cast/x/two.jpg',
        ])
        try {
          await setThumbnailSettings({
            styleNote: '',
            markPlacement: 'tl',
            references: [
              {
                id: newId(),
                r2Key: 'boom-busters/thumb-refs/x/a.png',
                mimeType: 'image/png',
                note: 'Hard side light',
                inUse: true,
              },
            ],
          })
          tests.slots = [
            {
              id: 'slot-1',
              type: 'still',
              brief: {
                type: 'still',
                coversText: 'x',
                description: 'A boardroom',
                motion: { kind: 'static' },
                transition: 'cut',
                prompt: 'a boardroom',
              },
              candidates: [
                {
                  id: 'c',
                  provider: 'pexels',
                  kind: 'image',
                  sourceUrl: 'https://x.test/a.png',
                  r2Key: 'boom-busters/stills/x/a.png',
                  licence: 'test',
                  chosen: true,
                },
              ],
            },
          ] as unknown as typeof tests.slots
          await db
            .update(thumbnailPackages)
            .set({
              picture: {
                ...planned('figure').picture,
                depicts: ['Test Person One'],
                stillSlotIds: ['slot-1'],
              },
            })
            .where(eq(thumbnailPackages.id, ids[0]!))

          // The plain paint is the control: it carries the still and the style as well.
          await paintThumbnailPicture(ids[0]!)
          expect(requestOf(0).references?.map((reference) => reference.kind)).toEqual([
            'character',
            'object',
            'style',
          ])

          const base = (await getThumbnailPackage(db, ids[0]!))!.pictureKey
          await paintThumbnailPicture(ids[0]!, { baseKey: base, note: 'fewer people' })

          const request = requestOf(1)
          expect(request.references?.map((reference) => reference.kind)).toEqual([
            'base',
            'character',
          ])
          expect(request.references?.[0]).toMatchObject({
            name: 'The picture to edit',
            mimeType: 'image/png',
          })
          expect(
            request.prompt.startsWith('Edit the attached picture. Change only this: fewer people.'),
          ).toBe(true)
          expect(request.prompt).toContain('1 portrait of Test Person One')
        } finally {
          await removeCast()
        }
      })

      it('a change keeps the picture it replaced', async () => {
        await withPicture()

        await paintThumbnailPicture(ids[0]!, { baseKey: OLD, note: 'darker sky' })

        const row = await getThumbnailPackage(db, ids[0]!)
        expect(row?.pictureKey).not.toBe(OLD)
        expect(row?.previousPictureKey).toBe(OLD)
        expect(row?.state).toBe('painting')
      })

      it('a repaint keeps the picture it replaced too', async () => {
        await withPicture()

        await paintThumbnailPicture(ids[0]!)

        const row = await getThumbnailPackage(db, ids[0]!)
        expect(row?.pictureKey).not.toBe(OLD)
        expect(row?.previousPictureKey).toBe(OLD)
      })

      it('a paint whose base moved buys nothing', async () => {
        await withPicture({ pictureKey: 'b', previousPictureKey: 'z' })

        await paintThumbnailPicture(ids[0]!, { baseKey: 'a', note: 'x' })

        expect(adapter.generate).not.toHaveBeenCalled()
        expect(await thumbnailLedger()).toHaveLength(0)
        expect(await getThumbnailPackage(db, ids[0]!)).toMatchObject({
          pictureKey: 'b',
          previousPictureKey: 'z',
          state: 'ready',
        })
      })

      it('a change on a package with no picture fails in words', async () => {
        await paintThumbnailPicture(ids[0]!, { baseKey: null, note: 'darker sky' })

        const row = await getThumbnailPackage(db, ids[0]!)
        expect(row).toMatchObject({
          state: 'failed',
          error: 'There is no picture to change. Regenerate the picture.',
          pictureKey: null,
        })
        expect(adapter.generate).not.toHaveBeenCalled()
      })

      it('a change that names someone the picture does not show is not bought', async () => {
        const member = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name: 'Zelda Quillfeather',
          role: 'Witness',
        })
        try {
          await withPicture({
            previousPictureKey: 'boom-busters/thumbs/x/art-older.png',
            depicts: [],
          })

          await paintThumbnailPicture(ids[0]!, {
            baseKey: OLD,
            note: 'put Zelda Quillfeather on the left',
          })

          expect(adapter.generate).not.toHaveBeenCalled()
          expect(await thumbnailLedger()).toHaveLength(0)
          expect(await getThumbnailPackage(db, ids[0]!)).toMatchObject({
            state: 'failed',
            error: 'Zelda Quillfeather is not shown in this picture. A change cannot add a person.',
            pictureKey: OLD,
            previousPictureKey: 'boom-busters/thumbs/x/art-older.png',
          })
        } finally {
          await deleteCastMember(db, member.id)
        }
      })

      it('a failed change leaves both pictures and the composite', async () => {
        await withPicture({ previousPictureKey: 'boom-busters/thumbs/x/art-older.png' })
        adapter.generate.mockImplementationOnce(async () => {
          throw new ContentPolicyError('google', 'the picture was refused')
        })

        await paintThumbnailPicture(ids[0]!, { baseKey: OLD, note: 'darker sky' })

        expect(await getThumbnailPackage(db, ids[0]!)).toMatchObject({
          state: 'failed',
          error: 'google: the picture was refused',
          pictureKey: OLD,
          previousPictureKey: 'boom-busters/thumbs/x/art-older.png',
          composedKey: OLD_COMPOSITE,
        })
      })

      it('portraits past the size cap are left out', async () => {
        // The real path: stored bytes are read, so their sizes count.
        vi.stubEnv('MOCK_PROVIDERS', '0')
        tests.keys = { google: 'test-key' }
        storage.configured = true
        const base = 6 * 1024 * 1024
        const each = 5 * 1024 * 1024
        expect(base + each).toBeLessThanOrEqual(CHANGE_IMAGES_MAX_BYTES)
        expect(base + 2 * each).toBeGreaterThan(CHANGE_IMAGES_MAX_BYTES)
        storage.sizes.set(OLD, base)
        storage.sizes.set('boom-busters/cast/x/one.jpg', each)
        storage.sizes.set('boom-busters/cast/x/two.jpg', each)
        const removeCast = await withCast([
          'boom-busters/cast/x/one.jpg',
          'boom-busters/cast/x/two.jpg',
        ])
        try {
          await withPicture()

          await paintThumbnailPicture(ids[0]!, { baseKey: OLD, note: 'darker sky' })

          const request = requestOf(0)
          expect(request.references?.map((reference) => reference.name)).toEqual([
            'The picture to edit',
            'Test Person One',
          ])
          expect(request.prompt).toContain('1 portrait of Test Person One')
          expect(request.prompt).not.toContain('Test Person Two,')
        } finally {
          await removeCast()
        }
      })

      it('a change records its note on the ledger', async () => {
        await withPicture()
        const note = 'a'.repeat(300)

        await paintThumbnailPicture(ids[0]!, { baseKey: OLD, note })

        const [entry] = await thumbnailLedger()
        expect((entry!.meta as Record<string, unknown>)['change']).toBe('a'.repeat(200))
      })

      it('a mock change gets a key of its own', async () => {
        await withPicture()

        await paintThumbnailPicture(ids[0]!, { baseKey: OLD, note: 'darker sky' })

        const row = await getThumbnailPackage(db, ids[0]!)
        expect(row?.pictureKey).toMatch(new RegExp(`/art-mock-${ids[0]}-[0-9a-f]{8}\\.png$`))
        expect(row?.previousPictureKey).toBe(OLD)
      })
    })

    it('painting an unknown package does nothing and does not throw', async () => {
      await expect(paintThumbnailPicture(newId())).resolves.toBeUndefined()
      expect(adapter.generate).not.toHaveBeenCalled()
    })

    it('a budget refusal fails the package in words', async () => {
      cost.refuse = true

      await paintThumbnailPicture(ids[0]!)

      const row = await getThumbnailPackage(db, ids[0]!)
      expect(row?.state).toBe('failed')
      expect(row?.error).toBe(
        'The monthly spend ceiling would be crossed by this picture, so it was not painted. ' +
          'Approve more budget, then paint it again.',
      )
      expect(adapter.generate).not.toHaveBeenCalled()
    })
  })

  describe('composing', () => {
    it('a compose that fails marks the package failed and keeps its picture', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '0')
      storage.configured = true
      compose.composeThumbnail.mockRejectedValue(new Error('The browser would not start.'))
      const { inserted } = await replaceUnapprovedGenerated(db, recordId, [planned('figure')])
      const id = inserted[0]!.id
      const pictureKey = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-bbb.png`
      await db
        .update(thumbnailPackages)
        .set({ pictureKey, state: 'painting' })
        .where(eq(thumbnailPackages.id, id))

      await composeThumbnailPackage(id)

      const row = await getThumbnailPackage(db, id)
      expect(compose.composeThumbnail).toHaveBeenCalledTimes(1)
      expect(row?.state).toBe('failed')
      expect(row?.error).toBe('The browser would not start.')
      expect(row?.pictureKey).toBe(pictureKey)
      expect(row?.composedKey).toBeNull()
    })

    it('a recompose deletes the old object only after the record lists the new one', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '0')
      storage.configured = true
      compose.composeThumbnail.mockResolvedValue({ jpeg: Buffer.from('new jpeg'), warnings: [] })
      const { inserted } = await replaceUnapprovedGenerated(db, recordId, [planned('figure')])
      const id = inserted[0]!.id
      const old = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/old-composite.jpg`
      await db
        .update(thumbnailPackages)
        .set({
          pictureKey: `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-ccc.png`,
          composedKey: old,
          state: 'painting',
          approvedAt: new Date(),
        })
        .where(eq(thumbnailPackages.id, id))
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: [old, 'boom-busters/thumbs/x/other.jpg'] })
        .where(eq(publishRecords.id, recordId))
      let listedAtDelete: string[] = []
      storage.delete.mockImplementation(async () => {
        const [record] = await db
          .select()
          .from(publishRecords)
          .where(eq(publishRecords.id, recordId))
        listedAtDelete = record!.uploadedThumbKeys
        return undefined
      })

      await composeThumbnailPackage(id)

      const row = await getThumbnailPackage(db, id)
      const fresh = row!.composedKey!
      expect(fresh).not.toBe(old)
      expect(storage.put).toHaveBeenCalledWith(fresh)
      expect(storage.delete.mock.calls.map((call) => call[0])).toEqual([old])
      expect(listedAtDelete).toEqual([fresh, 'boom-busters/thumbs/x/other.jpg'])
      expect(row?.state).toBe('ready')
    })

    it('composing an approved package swaps its key in the record', async () => {
      const { inserted } = await replaceUnapprovedGenerated(db, recordId, [planned('figure')])
      const id = inserted[0]!.id
      await db
        .update(thumbnailPackages)
        .set({
          pictureKey: `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-aaa.png`,
          composedKey: 'boom-busters/thumbs/x/old.jpg',
          state: 'ready',
          approvedAt: new Date(),
        })
        .where(eq(thumbnailPackages.id, id))
      await db
        .update(publishRecords)
        .set({
          uploadedThumbKeys: ['boom-busters/thumbs/x/old.jpg', 'boom-busters/thumbs/x/other.jpg'],
        })
        .where(eq(publishRecords.id, recordId))

      await composeThumbnailPackage(id)

      const mockKey = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/mock-${id}.jpg`
      const row = await getThumbnailPackage(db, id)
      expect(row?.composedKey).toBe(mockKey)
      expect(row?.warnings).toEqual([])
      expect(row?.state).toBe('ready')
      const [record] = await db.select().from(publishRecords).where(eq(publishRecords.id, recordId))
      expect(record?.uploadedThumbKeys).toEqual([mockKey, 'boom-busters/thumbs/x/other.jpg'])
    })
  })
})

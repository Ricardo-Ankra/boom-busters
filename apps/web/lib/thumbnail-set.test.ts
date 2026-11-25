// @vitest-environment node

import {
  costLedger,
  deleteCastMember,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getChannelSettings,
  getThumbnailPackage,
  insertCastMember,
  listThumbnailPackages,
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
import type * as Answer from '@/lib/answer'
import type * as Catalogue from '@/lib/model-catalogue'
import type * as Cost from '@boom-busters/cost'

/**
 * The thumbnail set against the real database in mock-provider mode, with the
 * image adapter, the planner call and the film's grounding replaced.
 */

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
    await db.delete(thumbnailPackages).where(eq(thumbnailPackages.publishRecordId, recordId))
    await setThumbnailSettings(originalThumbnails)
    await db.delete(costLedger).where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)
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
      expect(rows.map((row) => row.state)).toEqual(['ready', 'failed', 'ready'])
      expect(rows[1]!.error).toBe('google: the picture was refused')
      expect(rows[0]!.pictureKey).toContain(`/thumbs/${FIXTURE_PROJECT_ID}/art-`)
      expect(rows[1]!.pictureKey).toBeNull()
      // The refused image left nothing in the ledger: two settled rows, not three.
      const ledger = await thumbnailLedger()
      expect(ledger).toHaveLength(2)
      expect(ledger.every((entry) => entry.actualUsd !== null)).toBe(true)
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

// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  insertRender,
  insertShort,
  publishRecords,
  renders,
  requireTestDatabase,
  seed,
  setCredential,
  shorts,
  truncateRunMirror,
  updateRender,
  updateSettings,
} from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { forgetRunRows } from '../middleware/run-mirror'
import { publishRunner } from './publish-runner'

/**
 * The publish-runner against the real database. The live path is asserted
 * up to the media-utils submit (the harness cannot drive past a wait); what
 * matters here: preconditions refuse in words and leave the record in
 * `draft`, the §5 atomic claim stamps the quota-day counter, the daily
 * budget defers, and the wire job carries `privacyStatus: 'private'` with
 * the SHORT-LIVED token.
 */

const broker = vi.hoisted(() => ({
  configured: true,
  submitMediaJob: vi.fn(),
}))
vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => broker.configured,
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitMediaJob: broker.submitMediaJob,
  submitRender: vi.fn(),
  fetchRenderProgress: vi.fn(),
  cancelRender: vi.fn(),
}))

const storage = vi.hoisted(() => ({ configured: true }))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  presignGet: vi.fn().mockResolvedValue('https://r2.example.com/presigned'),
  putObject: vi.fn(),
}))

const providers = vi.hoisted(() => ({ mock: true }))
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, mockProvidersEnabled: () => providers.mock }
})

const google = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
}))
vi.mock('@/lib/youtube', () => ({
  refreshAccessToken: google.refreshAccessToken,
  setThumbnail: vi.fn().mockResolvedValue({ ok: true }),
  videoProcessed: vi.fn().mockResolvedValue(true),
  YoutubeAuthError: class extends Error {
    needsReconnect = false
  },
}))

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'

describeDb('publish-runner', () => {
  let engine: InngestTestEngine

  function requestedEvent(
    targetType: 'master' | 'short',
    targetId: string,
  ): [{ name: string; data: Record<string, unknown> }] {
    return [
      {
        name: 'publish/requested',
        data: { projectId: FIXTURE_PROJECT_ID, targetType, targetId },
      },
    ]
  }

  async function draftRecord(
    targetType: 'master' | 'short',
    targetId: string,
    overrides: Partial<typeof publishRecords.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(publishRecords)
      .values({
        targetType,
        targetId,
        publishAt: new Date('2026-08-28T15:00:00Z'),
        metadata: { title: 'The audit that lied', description: 'Wirecard.', tags: ['finance'] },
        ...overrides,
      })
      .returning()
    return row!
  }

  async function doneMasterRender() {
    const render = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 1,
      kind: 'master',
    })
    await updateRender(db, render.id, { status: 'done', outputS3Key: 'renders/master.mp4' })
    return render
  }

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: publishRunner })
    vi.clearAllMocks()
    providers.mock = true
    broker.configured = true
    storage.configured = true
    google.refreshAccessToken.mockResolvedValue({ accessToken: 'ya29.short', expiresInSec: 3599 })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(publishRecords)
    await db.delete(renders)
    await db.delete(shorts)
    await updateSettings(db, { publish: { dailyUploadBudget: 4 } })
  })

  it(
    'mock mode: preconditions, atomic claim, scheduled with the stamp',
    { timeout: 120_000 },
    async () => {
      await doneMasterRender()
      const record = await draftRecord('master', FIXTURE_PROJECT_ID, {
        uploadedThumbKeys: ['boom-busters/thumbs/a.png'],
      })

      const { result } = await engine.execute({
        events: requestedEvent('master', FIXTURE_PROJECT_ID),
      })

      expect(result).toMatchObject({ outcome: 'mock-scheduled' })
      const stored = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      expect(stored?.id).toBe(record.id)
      expect(stored?.status).toBe('scheduled')
      expect(stored?.youtubeVideoId).toContain('mock-')
      // The quota-day counter was stamped by the atomic claim.
      expect(stored?.uploadStartedAt).not.toBeNull()
      expect(broker.submitMediaJob).not.toHaveBeenCalled()
    },
  )

  it('refusals leave the record in draft, with the reason in words', async () => {
    await doneMasterRender()
    await draftRecord('master', FIXTURE_PROJECT_ID, {
      uploadedThumbKeys: [], // masters need a thumbnail first
    })

    const { result } = await engine.execute({
      events: requestedEvent('master', FIXTURE_PROJECT_ID),
    })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect((result as { reason: string }).reason).toContain('thumbnail')
    const stored = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    expect(stored?.status).toBe('draft')
    expect(stored?.error).toMatchObject({ message: expect.stringContaining('thumbnail') })
  })

  it('a Short without its related-link tick is refused by name', async () => {
    const short = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'x',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
    })
    await draftRecord('short', short.id)

    const { result } = await engine.execute({ events: requestedEvent('short', short.id) })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect((result as { reason: string }).reason).toContain('related-video link')
  })

  it('a record already past draft is left exactly alone', async () => {
    await doneMasterRender()
    await draftRecord('master', FIXTURE_PROJECT_ID, {
      status: 'scheduled',
      uploadedThumbKeys: ['boom-busters/thumbs/a.png'],
    })

    const { result } = await engine.execute({
      events: requestedEvent('master', FIXTURE_PROJECT_ID),
    })

    expect(result).toMatchObject({ outcome: 'already-handled', status: 'scheduled' })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.status).toBe('scheduled')
  })

  it('the spent daily budget defers instead of uploading', { timeout: 120_000 }, async () => {
    await updateSettings(db, { publish: { dailyUploadBudget: 1 } })
    await doneMasterRender()
    // One upload already started in this quota day.
    await draftRecord('short', '01HQ00000000000000000000T9', {
      status: 'scheduled',
      uploadStartedAt: new Date(),
    })
    await draftRecord('master', FIXTURE_PROJECT_ID, {
      uploadedThumbKeys: ['boom-busters/thumbs/a.png'],
    })

    // The overnight sleep is stubbed — the engine would otherwise
    // honour it in real time.
    const { result } = await engine.execute({
      events: requestedEvent('master', FIXTURE_PROJECT_ID),
      steps: [{ id: 'wait-quota-day', handler: () => undefined }],
    })

    // The budget is still spent on the re-check, so the item defers
    // rather than blowing the cap.
    expect(result).toMatchObject({ outcome: 'budget-deferred' })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.status).toBe('draft')
  })

  describe('live path', () => {
    beforeEach(async () => {
      providers.mock = false
      await setCredential(db, 'youtube', '1//refresh-token', env.SECRETS_ENCRYPTION_KEY)
    })

    it(
      'hands media-utils the job with a SHORT-LIVED token, private, scheduled',
      { timeout: 120_000 },
      async () => {
        await doneMasterRender()
        await draftRecord('master', FIXTURE_PROJECT_ID, {
          uploadedThumbKeys: ['boom-busters/thumbs/a.png'],
        })

        await engine.executeStep('submit-upload', {
          events: requestedEvent('master', FIXTURE_PROJECT_ID),
        })

        expect(google.refreshAccessToken).toHaveBeenCalledWith('1//refresh-token')
        expect(broker.submitMediaJob).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'upload-youtube',
            videoS3Key: 'renders/master.mp4',
            accessToken: 'ya29.short',
            title: 'The audit that lied',
            privacyStatus: 'private',
            publishAt: '2026-08-28T15:00:00.000Z',
          }),
        )
        // The claim happened before the spend: the record is uploading.
        const stored = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
        expect(stored?.status).toBe('uploading')
      },
    )
  })
})

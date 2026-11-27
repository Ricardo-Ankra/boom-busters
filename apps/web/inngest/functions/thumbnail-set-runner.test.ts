// @vitest-environment node

import { createHash } from 'node:crypto'
import {
  costLedger,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  getThumbnailPackage,
  listThumbnailPackages,
  mergePublishMetadata,
  replaceUnapprovedGenerated,
  requireTestDatabase,
  seed,
  publishRecords,
  thumbnailPackages,
} from '@boom-busters/db'
import type { PlannedPackage, ThumbnailIdea } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { thumbnailSetRunner } from './thumbnail-set-runner'

/**
 * The thumbnail runner against the real database in mock-provider mode, with
 * only the image adapter replaced so the calls can be counted.
 */

const adapter = vi.hoisted(() => ({ generate: vi.fn() }))
vi.mock('@/lib/model-catalogue', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, stillGenerator: () => ({ id: 'google', generate: adapter.generate }) }
})
vi.mock('@/inngest/lib/channel', () => ({ requireCompleteBible: <T>(inUse: T): T => inUse }))
vi.mock('@/lib/publish-grounding', () => ({
  metadataGrounding: vi.fn(async () => ({
    claims: [],
    centralQuestion: undefined,
    scriptVersion: 0,
  })),
  titleFrameFor: vi.fn(async () => null),
}))

/** The test engine keys its state by the hash of each step's id. */
const stepKeys = (ids: string[]): string[] =>
  ids.map((id) => createHash('sha1').update(id).digest('hex'))

const describeDb = requireTestDatabase() ? describe : describe.skip

const planned = (idea: ThumbnailIdea): PlannedPackage => ({
  idea,
  angle: `The ${idea} angle.`,
  title: `The ${idea} title`,
  headline: `The ${idea}`,
  picture: { subject: `a ${idea}`, framing: '', textSide: 'left', stillSlotIds: [], depicts: [] },
  claimIds: ['c1'],
})

const image = { url: 'data:image/png;base64,iVBORw0KGgo=', width: 2048, height: 1152 }

describeDb('thumbnail-set-runner (mock mode)', () => {
  let recordId = ''

  const run = (data: Record<string, unknown>) =>
    new InngestTestEngine({ function: thumbnailSetRunner }).execute({
      events: [
        {
          name: 'thumbnails/set.requested',
          data: { projectId: FIXTURE_PROJECT_ID, targetId: FIXTURE_PROJECT_ID, ...data },
        },
      ],
    })

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    adapter.generate.mockReset()
    adapter.generate.mockImplementation(async () => ({ images: [image], estimatedCostUsd: 0.15 }))
    await seed(db)
    recordId = (await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)).id
    await clearNote()
    await db.delete(thumbnailPackages).where(eq(thumbnailPackages.publishRecordId, recordId))
    await db.delete(costLedger).where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(thumbnailPackages).where(eq(thumbnailPackages.publishRecordId, recordId))
    await db.delete(costLedger).where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`)
    await clearNote()
  })

  const clearNote = async () => {
    const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
    // The claim goes with the note: a test's claim must not reach the next test or another suite.
    const {
      thumbnailSetNote: _gone,
      thumbnailSetRequestedAt: _claim,
      ...rest
    } = record.metadata as Record<string, unknown>
    await db.update(publishRecords).set({ metadata: rest }).where(eq(publishRecords.id, record.id))
  }
  const noteOf = async (): Promise<unknown> =>
    (
      (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata as Record<
        string,
        unknown
      >
    )['thumbnailSetNote']

  const onFailure = (
    thumbnailSetRunner as unknown as {
      opts: { onFailure: (ctx: unknown) => Promise<void> }
    }
  ).opts.onFailure
  const failure = (
    message: string,
    mode: 'set' | 'paint' | 'compose' = 'set',
    requestedAt?: string,
  ) => ({
    event: {
      data: {
        error: { message },
        event: {
          data: {
            projectId: FIXTURE_PROJECT_ID,
            targetId: FIXTURE_PROJECT_ID,
            mode,
            ...(requestedAt ? { requestedAt } : {}),
          },
        },
      },
    },
  })

  async function seedThree(): Promise<string[]> {
    const { inserted } = await replaceUnapprovedGenerated(db, recordId, [
      planned('figure'),
      planned('object'),
      planned('moment'),
    ])
    return inserted.map((row) => row.id)
  }

  it('a set plans, then paints and composes each package', async () => {
    const { result, state } = await run({ mode: 'set' })

    const rows = await listThumbnailPackages(db, recordId)
    expect(rows).toHaveLength(3)
    expect(Object.keys(state)).toEqual(
      stepKeys(['plan', ...rows.flatMap((row) => [`paint-${row.id}`, `compose-${row.id}`])]),
    )
    expect(adapter.generate).toHaveBeenCalledTimes(3)
    expect(rows.every((row) => row.state === 'ready' && row.composedKey !== null)).toBe(true)
    expect(result).toMatchObject({ mode: 'set', packages: 3 })
  })

  it('a set run whose claim was given back plans nothing', async () => {
    const { result } = await run({ mode: 'set', requestedAt: '2026-11-25T12:00:00.000Z' })

    expect(await listThumbnailPackages(db, recordId)).toHaveLength(0)
    expect(adapter.generate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ mode: 'set', packages: 0 })
  })

  it('a plan step that runs again after its plan landed paints what it wrote', async () => {
    // The first attempt stored its packages and cleared the claim; its answer was lost.
    const requestedAt = new Date(Date.now() - 1000).toISOString()
    const ids = await seedThree()

    const { result, state } = await run({ mode: 'set', requestedAt })

    expect(Object.keys(state)).toEqual(
      stepKeys(['plan', ...ids.flatMap((id) => [`paint-${id}`, `compose-${id}`])]),
    )
    expect(adapter.generate).toHaveBeenCalledTimes(3)
    const rows = await listThumbnailPackages(db, recordId)
    expect(rows.map((row) => row.id)).toEqual(ids)
    expect(rows.every((row) => row.state === 'ready')).toBe(true)
    expect(result).toMatchObject({ mode: 'set', packages: 3 })
  })

  it('packages planned before the claim are not picked up by a run that lost its claim', async () => {
    await seedThree()

    const { result } = await run({
      mode: 'set',
      requestedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    })

    expect(adapter.generate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ packages: 0 })
  })

  it('a set run whose claim was replaced plans nothing', async () => {
    const newer = '2026-11-25T12:05:00.000Z'
    await mergePublishMetadata(db, recordId, { thumbnailSetRequestedAt: newer })

    const { result } = await run({ mode: 'set', requestedAt: '2026-11-25T12:00:00.000Z' })

    expect(await listThumbnailPackages(db, recordId)).toHaveLength(0)
    expect(adapter.generate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ packages: 0 })
    const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
    expect(metadata['thumbnailSetRequestedAt']).toBe(newer)
  })

  it('a set run under its own claim plans', async () => {
    const stamp = new Date().toISOString()
    await mergePublishMetadata(db, recordId, { thumbnailSetRequestedAt: stamp })

    const { result } = await run({ mode: 'set', requestedAt: stamp })

    expect(await listThumbnailPackages(db, recordId)).toHaveLength(3)
    expect(result).toMatchObject({ packages: 3 })
  })

  it('paint mode touches one package', async () => {
    const ids = await seedThree()

    const { state } = await run({ mode: 'paint', packageId: ids[1] })

    expect(Object.keys(state)).toEqual(stepKeys([`paint-${ids[1]}`, `compose-${ids[1]}`]))
    expect(adapter.generate).toHaveBeenCalledTimes(1)
    const rows = await listThumbnailPackages(db, recordId)
    expect(rows.map((row) => row.state)).toEqual(['planned', 'ready', 'planned'])
  })

  const OLD_PICTURE = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-old.png`

  it('a change paints with the note and the base key, then composes', async () => {
    const ids = await seedThree()
    await db
      .update(thumbnailPackages)
      .set({ pictureKey: OLD_PICTURE, state: 'ready' })
      .where(eq(thumbnailPackages.id, ids[0]!))

    const { state } = await run({
      mode: 'change',
      packageId: ids[0],
      note: 'darker sky',
      baseKey: OLD_PICTURE,
    })

    expect(Object.keys(state)).toEqual(stepKeys([`paint-${ids[0]}`, `compose-${ids[0]}`]))
    expect(adapter.generate).toHaveBeenCalledTimes(1)
    const request = adapter.generate.mock.calls[0]![0] as { prompt: string }
    expect(request.prompt).toContain('Change only this: darker sky.')
    const row = await getThumbnailPackage(db, ids[0]!)
    expect(row).toMatchObject({ state: 'ready', previousPictureKey: OLD_PICTURE })
    expect(row?.pictureKey).not.toBe(OLD_PICTURE)
    expect(row?.composedKey).not.toBeNull()
  })

  it('a retried change goes straight to the compose', async () => {
    const ids = await seedThree()
    const landed = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-landed.png`
    await db
      .update(thumbnailPackages)
      .set({ pictureKey: landed, previousPictureKey: OLD_PICTURE, state: 'painting' })
      .where(eq(thumbnailPackages.id, ids[0]!))

    await run({ mode: 'change', packageId: ids[0], note: 'darker sky', baseKey: OLD_PICTURE })

    expect(adapter.generate).not.toHaveBeenCalled()
    expect(
      await db
        .select()
        .from(costLedger)
        .where(sql`${costLedger.meta}->>'kind' = 'thumbnail'`),
    ).toHaveLength(0)
    const row = await getThumbnailPackage(db, ids[0]!)
    expect(row).toMatchObject({ state: 'ready', pictureKey: landed })
    expect(row?.composedKey).not.toBeNull()
  })

  it('a paint sent before the base key existed paints as before', async () => {
    const ids = await seedThree()
    await db
      .update(thumbnailPackages)
      .set({ pictureKey: OLD_PICTURE, state: 'ready' })
      .where(eq(thumbnailPackages.id, ids[0]!))

    await run({ mode: 'paint', packageId: ids[0] })

    expect(adapter.generate).toHaveBeenCalledTimes(1)
    const request = adapter.generate.mock.calls[0]![0] as { prompt: string }
    expect(request.prompt).not.toContain('Edit the attached picture')
    const row = await getThumbnailPackage(db, ids[0]!)
    expect(row?.pictureKey).not.toBe(OLD_PICTURE)
    expect(row?.previousPictureKey).toBe(OLD_PICTURE)
  })

  it('compose mode buys nothing', async () => {
    const ids = await seedThree()
    await db
      .update(thumbnailPackages)
      .set({ pictureKey: `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-x.png`, state: 'failed' })
      .where(eq(thumbnailPackages.id, ids[0]!))

    const { state } = await run({ mode: 'compose', packageId: ids[0] })

    expect(Object.keys(state)).toEqual(stepKeys([`compose-${ids[0]}`]))
    expect(adapter.generate).not.toHaveBeenCalled()
    expect((await getThumbnailPackage(db, ids[0]!))?.state).toBe('ready')
  })

  it('a failed paint is not composed', async () => {
    adapter.generate
      .mockImplementationOnce(async () => ({ images: [image], estimatedCostUsd: 0.15 }))
      .mockImplementationOnce(async () => {
        throw new Error('the picture was refused')
      })
      .mockImplementationOnce(async () => ({ images: [image], estimatedCostUsd: 0.15 }))

    const { state } = await run({ mode: 'set' })

    const rows = await listThumbnailPackages(db, recordId)
    expect(rows.map((row) => row.state)).toEqual(['ready', 'failed', 'ready'])
    expect(Object.keys(state)).toEqual(
      stepKeys([
        'plan',
        `paint-${rows[0]!.id}`,
        `compose-${rows[0]!.id}`,
        `paint-${rows[1]!.id}`,
        `paint-${rows[2]!.id}`,
        `compose-${rows[2]!.id}`,
      ]),
    )
  })

  it('a crash with nothing to mark leaves the reason in the set note', async () => {
    await onFailure(failure('The planner was unreachable.'))

    expect(await noteOf()).toBe('The set could not be made: The planner was unreachable.')
  })

  it('a crash keeps a note this run already wrote', async () => {
    await clearNote()
    const record = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!
    await db
      .update(publishRecords)
      .set({ metadata: { ...record.metadata, thumbnailSetNote: 'Planned 1 of 3. Figure: x.' } })
      .where(eq(publishRecords.id, record.id))

    await onFailure(failure('The planner was unreachable.'))

    expect(await noteOf()).toBe('Planned 1 of 3. Figure: x.')
  })

  it('a crash clears the claim', async () => {
    await mergePublishMetadata(db, recordId, {
      thumbnailSetRequestedAt: new Date().toISOString(),
    })

    await onFailure(failure('The planner was unreachable.'))

    const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
    expect(metadata['thumbnailSetRequestedAt']).toBeUndefined()
  })

  it('a failed set run leaves a newer claim alone', async () => {
    const newer = new Date().toISOString()
    await mergePublishMetadata(db, recordId, { thumbnailSetRequestedAt: newer })

    await onFailure(failure('The planner was unreachable.', 'set', '2026-11-25T12:00:00.000Z'))

    const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
    expect(metadata['thumbnailSetRequestedAt']).toBe(newer)
  })

  it('a failed set run clears its own claim', async () => {
    const stamp = new Date().toISOString()
    await mergePublishMetadata(db, recordId, { thumbnailSetRequestedAt: stamp })

    await onFailure(failure('The planner was unreachable.', 'set', stamp))

    const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
    expect(metadata['thumbnailSetRequestedAt']).toBeUndefined()
  })

  it('a failed paint run leaves the claim alone', async () => {
    // The claim belongs to a set run that is queued behind this paint run.
    await mergePublishMetadata(db, recordId, {
      thumbnailSetRequestedAt: new Date().toISOString(),
    })

    await onFailure(failure('The picture model refused.', 'paint'))

    const metadata = (await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))!.metadata
    expect(metadata['thumbnailSetRequestedAt']).toEqual(expect.any(String))
  })

  it('a set run does not repaint a package that already has its picture', async () => {
    const ids = await seedThree()
    const picture = `boom-busters/thumbs/${FIXTURE_PROJECT_ID}/art-kept.png`
    await db
      .update(thumbnailPackages)
      .set({ pictureKey: picture, state: 'painting' })
      .where(eq(thumbnailPackages.id, ids[0]!))

    // The plan step has already landed (a retried run): only its result is replayed.
    const { state } = await new InngestTestEngine({ function: thumbnailSetRunner }).execute({
      events: [
        {
          name: 'thumbnails/set.requested',
          data: { projectId: FIXTURE_PROJECT_ID, targetId: FIXTURE_PROJECT_ID, mode: 'set' },
        },
      ],
      steps: [{ id: 'plan', handler: () => ({ inserted: [ids[0]!], dropped: [] }) }],
    })

    expect(adapter.generate).not.toHaveBeenCalled()
    expect(Object.keys(state)).toEqual(stepKeys(['plan', `paint-${ids[0]}`, `compose-${ids[0]}`]))
    const row = await getThumbnailPackage(db, ids[0]!)
    expect(row).toMatchObject({ state: 'ready', pictureKey: picture })
    expect(row?.composedKey).not.toBeNull()
  })

  it('a crash marks unfinished packages failed', async () => {
    const ids = await seedThree()
    await db
      .update(thumbnailPackages)
      .set({ state: 'painting' })
      .where(eq(thumbnailPackages.id, ids[1]!))
    await db
      .update(thumbnailPackages)
      .set({ state: 'ready', composedKey: 'boom-busters/thumbs/x/done.jpg' })
      .where(eq(thumbnailPackages.id, ids[2]!))

    await onFailure(failure('The browser would not start.'))

    const rows = await listThumbnailPackages(db, recordId)
    expect(rows.map((row) => row.state)).toEqual(['failed', 'failed', 'ready'])
    expect(rows[0]!.error).toBe('The browser would not start.')
    expect(rows[2]!.error).toBeNull()
  })
})

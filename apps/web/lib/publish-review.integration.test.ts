// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  insertShort,
  insertTalkingPointSet,
  approveTalkingPointSet,
  publishRecords,
  requireTestDatabase,
  seed,
  shorts,
  talkingPointSets,
  updatePublishRecord,
  updateChannelSettings,
} from '@boom-busters/db'
import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  PUBLISH_DISCLAIMER,
} from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { descriptionIngredients, publishModel } from './publish-review'

/**
 * The Publish screen's "x of N upload starts" must use the budget of the
 * project's own channel, the one the publish runner enforces.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('publishModel budget', () => {
  it("reports the project's channel's daily upload budget, not the first channel's", async () => {
    await seed(db)
    await updateChannelSettings(db, FIRST_CHANNEL_ID, { publish: { dailyUploadBudget: 6 } })

    const other = await createChannel(db, {
      name: 'Budget channel',
      handle: null,
      slug: `budget-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    await updateChannelSettings(db, other.id, { publish: { dailyUploadBudget: 2 } })
    const otherCase = await createCase(db, { channelId: other.id, title: 'B', category: 'con' })
    const otherProject = await createProjectFromCase(db, { caseId: otherCase.id, title: 'On B' })

    expect((await publishModel(db, otherProject.id, { presign: null })).dailyUploadBudget).toBe(2)
    expect((await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })).dailyUploadBudget).toBe(
      6,
    )
  })

  it("carries the project's frozen bible's disclaimer for the description", async () => {
    await seed(db)
    const other = await createChannel(db, {
      name: 'Disclaimer channel',
      handle: null,
      slug: `disclaimer-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, disclaimer: 'This is education, not advice.' },
    })
    const otherCase = await createCase(db, { channelId: other.id, title: 'D', category: 'con' })
    const otherProject = await createProjectFromCase(db, { caseId: otherCase.id, title: 'On D' })

    expect((await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })).disclaimer).toBe(
      PUBLISH_DISCLAIMER,
    )
    expect((await publishModel(db, otherProject.id, { presign: null })).disclaimer).toBe(
      'This is education, not advice.',
    )
    expect((await descriptionIngredients(db, otherProject.id)).disclaimer).toBe(
      'This is education, not advice.',
    )
  })
})

describeDb('publishModel point Short pre-fill (design section 8)', () => {
  const day = 86_400_000
  const byTarget = async () => {
    const model = await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })
    return new Map(model.items.map((item) => [item.label, item]))
  }

  async function setUp(masterAt: Date | null) {
    await seed(db)
    await db.delete(publishRecords)
    await db.delete(shorts)
    await db.delete(talkingPointSets)
    const points = [
      { id: 'point-a', order: 1 },
      { id: 'point-b', order: 2 },
    ] as unknown as TalkingPoint[]
    await insertTalkingPointSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      scriptVersion: 1,
      points,
      note: null,
    })
    await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, 1)
    const base = {
      projectId: FIXTURE_PROJECT_ID,
      segmentRef: { chapterId: 'c', fromParagraph: 0, toParagraph: 0 },
      kind: 'point' as const,
      sourceTimeline: {},
    }
    // Built in the reverse of their order: the pre-fill follows `order`.
    await insertShort(db, { ...base, title: 'Second point', pointId: 'point-b' })
    await insertShort(db, { ...base, title: 'First point', pointId: 'point-a' })
    await insertShort(db, {
      ...base,
      title: 'Old excerpt',
      kind: 'excerpt',
      sourceTimeline: undefined,
    })
    if (masterAt) {
      const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      await updatePublishRecord(db, record.id, { status: 'scheduled', publishAt: masterAt })
    }
  }

  it('suggests the next Short slots after the long form, in point order', async () => {
    const master = new Date(Date.now() + 10 * day)
    await setUp(master)
    const items = await byTarget()

    const first = items.get('First point')?.suggestedPublishAtIso
    const second = items.get('Second point')?.suggestedPublishAtIso
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(new Date(first!).getTime()).toBeGreaterThan(master.getTime())
    expect(new Date(second!).getTime()).toBeGreaterThan(new Date(first!).getTime())
    // Each lands on one of the default Short slots (Sat, Mon, Wed 16:00 UTC).
    for (const iso of [first!, second!]) {
      const at = new Date(iso)
      expect([6, 1, 3]).toContain(at.getUTCDay())
      expect(at.getUTCHours()).toBe(16)
    }
    // Nothing is scheduled by the suggestion, and legacy Shorts carry none.
    expect(items.get('First point')?.record).toBeNull()
    expect(items.get('Old excerpt')?.suggestedPublishAtIso ?? null).toBeNull()
  })

  it('suggests nothing before the long form has a time, or once the Short has one', async () => {
    await setUp(null)
    expect((await byTarget()).get('First point')?.suggestedPublishAtIso ?? null).toBeNull()

    await setUp(new Date(Date.now() + 10 * day))
    const record = await ensurePublishRecord(
      db,
      'short',
      (await byTarget()).get('First point')!.targetId,
    )
    await updatePublishRecord(db, record.id, { publishAt: new Date(Date.now() + 20 * day) })
    const items = await byTarget()
    expect(items.get('First point')?.suggestedPublishAtIso ?? null).toBeNull()
    // The one still unscheduled takes the first slot, not the second.
    expect(items.get('Second point')?.suggestedPublishAtIso).toBeTruthy()
  })
})

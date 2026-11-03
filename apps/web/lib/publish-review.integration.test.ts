// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  insertShort,
  moveProjectBible,
  saveBibleVersion,
  currentBible,
  insertTalkingPointSet,
  approveTalkingPointSet,
  projects,
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
  defaultFormat,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  PUBLISH_DISCLAIMER,
} from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { descriptionIngredients, publishModel, spokenIntro } from './publish-review'

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

describeDb('publishModel after Use the latest bible', () => {
  it("reads the newer version's disclaimer once the project is moved onto it", async () => {
    await seed(db)
    const other = await createChannel(db, {
      name: 'Moved channel',
      handle: null,
      slug: `moved-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, disclaimer: 'The first disclaimer.' },
    })
    const kase = await createCase(db, { channelId: other.id, title: 'M', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'On M' })
    expect((await descriptionIngredients(db, project.id)).disclaimer).toBe('The first disclaimer.')

    const v2 = await saveBibleVersion(
      db,
      other.id,
      { ...EMPTY_BIBLE, disclaimer: 'The second disclaimer.' },
      'New disclaimer',
    )
    // Frozen until the owner moves it.
    expect((await descriptionIngredients(db, project.id)).disclaimer).toBe('The first disclaimer.')

    await moveProjectBible(db, project.id, (await currentBible(db, other.id)).id)
    expect(v2.id).toBe((await currentBible(db, other.id)).id)
    expect((await descriptionIngredients(db, project.id)).disclaimer).toBe('The second disclaimer.')
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

describeDb('publishModel search brief fields', () => {
  it('says whether a brief is frozen, and carries the scores, the note and the marked tags', async () => {
    await seed(db)
    await db.delete(publishRecords)
    await db.update(projects).set({ searchBrief: null })
    expect(await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })).toMatchObject({
      hasSearchBrief: false,
      titleScoreCredits: 5,
    })

    await db.update(projects).set({
      searchBrief: {
        subject: 'Wirecard',
        measuredAt: '2026-11-02T12:00:00.000Z',
        targetKeyword: null,
        secondaryKeywords: [],
        searchedQuestions: [],
        outliers: [],
        titlePatterns: [],
        toldAlready: [],
        angleOptions: [],
        chosenAngle: null,
      },
    })
    const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await updatePublishRecord(db, record.id, {
      metadata: {
        titleOptions: ['A title', 'B title'],
        titleScores: { 'A title': 71, 'B title': null },
        titleScoreNote: 'VidIQ scored 2 of 3 titles, then stopped: the cap is reached.',
        searchTags: ['wirecard scandal'],
      },
    })
    try {
      const model = await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })
      expect(model.hasSearchBrief).toBe(true)
      expect(model.items[0]!.record).toMatchObject({
        titleScores: { 'A title': 71, 'B title': null },
        titleScoreNote: 'VidIQ scored 2 of 3 titles, then stopped: the cap is reached.',
        searchTags: ['wirecard scandal'],
      })
    } finally {
      await db.update(projects).set({ searchBrief: null })
    }
  })
})

describeDb('publishModel cohesion', () => {
  async function projectOn(keywords: string[], title: string) {
    const channel = await createChannel(db, {
      name: 'Cohesion channel',
      handle: null,
      slug: `cohesion-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, formats: [{ ...defaultFormat('Main'), keywords }] },
    })
    const kase = await createCase(db, {
      channelId: channel.id,
      title: 'Cleopatra',
      category: 'con',
    })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Cleopatra' })
    const record = await ensurePublishRecord(db, 'master', project.id)
    await updatePublishRecord(db, record.id, { metadata: { title, titleOptions: [title] } })
    return project
  }

  it('reports a miss in the format column when the title lacks the lead keyword', async () => {
    await seed(db)
    const project = await projectOn(['documentary'], 'Cleopatra and the asp')
    const { cohesion } = (await publishModel(db, project.id, { presign: null })).items[0]!
    expect(cohesion?.cells.title.format).toBe('miss')
    expect(cohesion?.cells.title.topic).toBe('hit')
  })

  it('reports the format column as not set, with a gap, on a default format', async () => {
    await seed(db)
    const project = await projectOn([], 'Cleopatra and the asp')
    const { cohesion } = (await publishModel(db, project.id, { presign: null })).items[0]!
    expect(cohesion?.cells.title.format).toBe('none')
    expect(cohesion?.gaps).toContain('No format keywords set')
  })

  it('does not credit an unwritten description with the generated hook', async () => {
    await seed(db)
    await db.delete(publishRecords)
    const { hook } = await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })
    const lead = hook.split(/\s+/)[0]!
    const original = await currentBible(db, FIRST_CHANNEL_ID)
    const frozen = await saveBibleVersion(
      db,
      FIRST_CHANNEL_ID,
      { ...original.bible, formats: [{ ...original.bible.formats[0]!, keywords: [lead] }] },
      'Lead keyword from the hook',
    )
    await moveProjectBible(db, FIXTURE_PROJECT_ID, frozen.id)
    try {
      const { cohesion } = (await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })).items[0]!
      expect(cohesion?.cells.descriptionOpening.format).toBe('miss')
    } finally {
      await moveProjectBible(db, FIXTURE_PROJECT_ID, original.id)
    }
  })

  it('has no report for a Short', async () => {
    await seed(db)
    const model = await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })
    for (const item of model.items.filter((i) => i.targetType === 'short')) {
      expect(item.cohesion).toBeNull()
    }
  })
})

describe('spokenIntro', () => {
  const md = ['# The rise', 'One two [pause] three four.', 'Five six seven eight nine ten.'].join(
    '\n\n',
  )

  it('takes round(30 x wordsPerMinute / 60) words, skipping headings and markup', () => {
    // 120 wpm: 60 words, so the whole chapter; 8 words at 16 wpm.
    expect(spokenIntro(md, 120)).toBe('One two three four. Five six seven eight nine ten.')
    expect(spokenIntro(md, 16)).toBe('One two three four. Five six seven eight')
  })

  it('is empty for an empty chapter', () => {
    expect(spokenIntro('', 150)).toBe('')
  })
})

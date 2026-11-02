// @vitest-environment node

import {
  chapters,
  FIXTURE_PROJECT_ID,
  getShort,
  notices,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  shorts,
  talkingPointSets,
  timelines,
  updateShort,
} from '@boom-busters/db'
import { PointScriptRecordSchema, TimelineSchema } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { CHAPTER_IDS, seedPointShort } from './point-studio.fixture'
import { pointStudioModel } from './point-studio-model'
import { shortsModel } from './shorts-review'

/**
 * The point Short studio's model against the real database in mock-provider
 * mode: the script as five labelled phases with live word count and runtime,
 * the shot list on the voiced clock, the long form's library and the fetched
 * pool, and the rule book's findings recomputed from the stored master.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  stillKey: vi.fn(),
  stockKey: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip
const presign = async (key: string) => `https://signed.example/${key}`

describeDb('pointStudioModel', () => {
  let shortId: string
  const studioOf = async () => (await pointStudioModel(db, shortId, { presign }))!

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await db.delete(notices)
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(talkingPointSets)
    await db.delete(chapters)
    await db.delete(scripts)
    shortId = (await seedPointShort()).shortId
  }, 120_000)

  it('shows the script as five labelled phases with each paragraph voiced', async () => {
    const model = await studioOf()

    expect(model.phases.map((phase) => phase.phase)).toEqual([
      'hook',
      'stakes',
      'delivery',
      'resolution',
      'bridge',
    ])
    const paragraphs = model.phases.flatMap((phase) => phase.paragraphs)
    expect(paragraphs.length).toBeGreaterThanOrEqual(5)
    expect(paragraphs.every((paragraph) => paragraph.voiced)).toBe(true)
    expect(paragraphs.every((paragraph) => CHAPTER_IDS.length > paragraph.chapterIndex)).toBe(true)
  })

  it('counts the words and estimates the runtime on the voiced clock', async () => {
    const row = (await getShort(db, shortId))!
    const script = PointScriptRecordSchema.parse(row.pointScript)
    const spoken = script.paragraphs.reduce(
      (sum, paragraph) => sum + paragraph.text.split(/\s+/).filter(Boolean).length,
      0,
    )

    const model = await studioOf()

    expect(model.words).toBe(spoken)
    // Every paragraph is 10 s, 150 ms apart.
    const expected = script.paragraphs.length * 10 + (script.paragraphs.length - 1) * 0.15
    expect(model.estimatedRuntimeSec).toBe(Math.round(expected))
  })

  it('estimates the runtime from the pace when a paragraph is no longer voiced', async () => {
    const row = (await getShort(db, shortId))!
    const script = PointScriptRecordSchema.parse(row.pointScript)
    await updateShort(db, shortId, {
      pointScript: {
        ...script,
        paragraphs: script.paragraphs.map((paragraph, index) =>
          index === 0 ? { ...paragraph, text: `${paragraph.text} And one more thing.` } : paragraph,
        ),
      },
    })

    const model = await studioOf()

    const paragraphs = model.phases.flatMap((phase) => phase.paragraphs)
    expect(paragraphs[0]!.voiced).toBe(false)
    expect(paragraphs.slice(1).every((paragraph) => paragraph.voiced)).toBe(true)
    // 160 words a minute: the middle of the rule book's 150 to 170.
    expect(model.estimatedRuntimeSec).toBe(Math.round((model.words / 160) * 60))
  })

  it('lists the shots on the voiced clock, each tagged long form or new', async () => {
    const row = (await getShort(db, shortId))!
    const timeline = TimelineSchema.parse(row.sourceTimeline)

    const model = await studioOf()

    expect(model.shots).toHaveLength(timeline.slots.length)
    expect(model.shots.map((shot) => shot.index)).toEqual(model.shots.map((_, i) => i))
    expect(model.shots[0]!.startMs).toBe(0)
    // Each shot starts where the stored master's slot does.
    expect(model.shots.map((shot) => [shot.startMs, shot.durationMs])).toEqual(
      timeline.slots.map((slot) => [slot.startMs, slot.durationMs]),
    )
    expect(model.shots.every((shot) => ['left', 'centre', 'right'].includes(shot.crop))).toBe(true)
    expect(model.shots.map((shot) => shot.source)).toContain('long form')
    expect(model.shots.map((shot) => shot.source)).toContain('new')
  })

  it("offers the long form's slots as the library and presigns thumbnails", async () => {
    const model = await studioOf()

    expect(model.library).toHaveLength(6)
    expect(model.library[0]!.url).toBe('https://signed.example/boom-busters/stills/0.png')
    expect(model.library[0]!.slot.payload.kind).toBe('image')
    const longFormShot = model.shots.find((shot) => shot.source === 'long form')
    expect(longFormShot?.thumbUrl).toMatch(/^https:\/\/signed\.example\//)
    expect(model.fetched.length).toBeGreaterThan(0)
    expect(model.fetched.every((option) => option.id !== '')).toBe(true)
  })

  it('recomputes the rule book findings from the stored master', async () => {
    const model = await studioOf()

    // The seed's narration runs about 51 s over a short script: the findings
    // are whatever the rule book says of the stored cut, and they name a rule.
    expect(Array.isArray(model.findings)).toBe(true)
    for (const finding of model.findings) {
      expect(typeof finding.rule).toBe('string')
      expect(finding.message.length).toBeGreaterThan(0)
    }
    const words = model.findings.find((finding) => finding.rule === 'words')
    expect(Boolean(words)).toBe(model.words < 110 || model.words > 160)
  })

  it('says the Short was written from an earlier script only when a newer one exists', async () => {
    expect((await studioOf()).scriptBehind).toBe(false)

    await db.insert(scripts).values({ projectId: FIXTURE_PROJECT_ID, version: 2 })

    expect((await studioOf()).scriptBehind).toBe(true)
  })

  it('carries the price of one generated still and the work in flight', async () => {
    const idle = await studioOf()
    expect(idle.stillEstimateUsd).toBeGreaterThanOrEqual(0)
    expect(idle.pending).toBeNull()
    expect(idle.failure).toBeNull()

    const row = (await getShort(db, shortId))!
    await updateShort(db, shortId, {
      pointFetches: {
        candidates: row.pointFetches!.candidates,
        state: { state: 'failed', what: 'still', reason: 'the model refused that picture' },
      },
    })
    const failed = await studioOf()
    expect(failed.failure).toBe('the model refused that picture')

    await updateShort(db, shortId, {
      pointFetches: {
        candidates: row.pointFetches!.candidates,
        state: { state: 'fetching', what: 'voice', startedAt: new Date().toISOString() },
      },
    })
    expect((await studioOf()).pending).toBe('voice')
  })

  it("puts the point's type, bridge chapters, findings count and script state on the card", async () => {
    const { shorts: cards } = await shortsModel(db, FIXTURE_PROJECT_ID, { presign })
    const card = cards.find((candidate) => candidate.id === shortId)!

    const studio = await studioOf()
    expect(card.kind).toBe('point')
    expect(card.teaser).toBeNull()
    expect(card.point).toEqual({
      type: expect.any(String),
      bridgeChapterTitles: ['Chapter 2', 'Chapter 3'],
      findings: studio.findings.length,
      scriptBehind: false,
    })
  })

  it('builds the full studio only for the open Short; the card is light', async () => {
    const closed = (await shortsModel(db, FIXTURE_PROJECT_ID, { presign })).shorts
    expect(closed.every((card) => card.studio === null)).toBe(true)
    expect(closed.find((card) => card.id === shortId)!.point).not.toBeNull()

    const open = (await shortsModel(db, FIXTURE_PROJECT_ID, { presign, studioShortId: shortId }))
      .shorts
    const card = open.find((entry) => entry.id === shortId)!
    expect(card.studio?.phases.length).toBe(5)
    expect(card.point).toEqual(closed.find((entry) => entry.id === shortId)!.point)
  })

  it('a point row with an unreadable script degrades its own card, not the screen', async () => {
    await updateShort(db, shortId, { pointScript: { nonsense: true } as never })

    const { shorts: cards } = await shortsModel(db, FIXTURE_PROJECT_ID, {
      presign,
      studioShortId: shortId,
    })

    const card = cards.find((entry) => entry.id === shortId)!
    expect(card.kind).toBe('point')
    expect(card.point).toBeNull()
    expect(card.studio).toBeNull()
    expect(await pointStudioModel(db, shortId, { presign })).toBeNull()
  })
})

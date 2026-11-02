// @vitest-environment node

import {
  approveTalkingPointSet,
  chapters,
  createCase,
  createChannel,
  createProjectFromCase,
  FIXTURE_PROJECT_ID,
  getProject,
  insertShort,
  insertTalkingPointSet,
  insertTimeline,
  listProjectNotices,
  listShorts,
  notices,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  setCredential,
  setProjectStage,
  shorts,
  talkingPointSets,
  timelines,
  getShort,
  truncateRunMirror,
  updateChannelSettings,
  updateWorkspace,
} from '@boom-busters/db'
import { truncateLedger } from '@boom-busters/cost'
import { mockImageGen, mockPointScript, mockTalkingPoints } from '@boom-busters/providers'
import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  noticesFor,
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  resolveBrandKit,
  TimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'
import type { TalkingPoint, Timeline } from '@boom-busters/schemas'
import type * as Tts from '@/lib/tts'
import { POINT_CHAPTER_ID } from '@boom-busters/timeline'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FROZEN_BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { inngest } from '../client'
import { savePointProgress } from '../lib/point-build'
import { forgetRunRows } from '../middleware/run-mirror'
import { pointShortRunner } from './point-short-runner'

/**
 * The point-short-runner against the real database, in mock-provider mode
 * (design 3.4): an approved talking point becomes one `point` Short and one
 * render request; a failed picture, a refused script, a budget refusal and a
 * repeated event each land as the design says.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  stillKey: vi.fn(),
  stockKey: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))
// Counted, not replaced: a re-run must make no script, plan or synthesis call
// for anything already bought.
const spies = vi.hoisted(() => ({
  mockPointScript: vi.fn(),
  mockPointPlan: vi.fn(),
  synthesise: vi.fn(),
}))
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof Providers
  spies.mockPointScript.mockImplementation(actual.mockPointScript)
  spies.mockPointPlan.mockImplementation(actual.mockPointPlan)
  return { ...actual, mockPointScript: spies.mockPointScript, mockPointPlan: spies.mockPointPlan }
})
vi.mock('@/lib/tts', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof Tts
  spies.synthesise.mockImplementation(actual.synthesise)
  return { ...actual, synthesise: spies.synthesise }
})
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER_IDS = [
  '01HQ0000000000000000000CH1',
  '01HQ0000000000000000000CH2',
  '01HQ0000000000000000000CH3',
]
const POINT_IDS = [1, 2, 3].map((n) => `01HQ0000000000000000000P0${n}`)

const CHAPTER_MD =
  'By June, the auditors could not find the money.\n\nEY refused to sign the accounts.'

function canonicalMaster(): Timeline {
  const slot = (startMs: number, i: number) => ({
    type: 'still' as const,
    startMs,
    durationMs: 6000,
    transition: 'cut' as const,
    motion: { kind: 'static' as const },
    payload: { kind: 'image' as const, src: { r2Key: `boom-busters/stills/${i}.png` } },
  })
  return TimelineSchema.parse({
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: CHAPTER_IDS.map((chapterId, index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 12_000,
      durationMs: 12_000,
      chapterId,
      paragraphIndex: 0,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [0, 1, 2, 3, 4, 5].map((i) => slot(i * 6000, i)),
    overlays: [],
  })
}

async function storeApprovedSet(): Promise<TalkingPoint[]> {
  const drafts = mockTalkingPoints(
    [0, 1, 2].map((index) => ({ index, title: `Chapter ${index + 1}`, contentMd: CHAPTER_MD })),
  )
  const points: TalkingPoint[] = POINT_IDS.map((id, i) => ({
    ...drafts[i]!,
    id,
    sourceChapters: [i],
    bridgeChapters: [(i + 1) % 3],
    order: i + 1,
  }))
  const set = await insertTalkingPointSet(db, {
    projectId: FIXTURE_PROJECT_ID,
    scriptVersion: 1,
    points,
    note: null,
  })
  await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, set.version)
  return points
}

const builtRow = (pointId: string) =>
  insertShort(db, {
    projectId: FIXTURE_PROJECT_ID,
    title: 'Already built',
    segmentRef: { chapterId: POINT_CHAPTER_ID, fromParagraph: 0, toParagraph: 4 },
    kind: 'point',
    pointId,
    sourceTimeline: canonicalMaster() as unknown as Record<string, unknown>,
  })

describeDb('point-short-runner', () => {
  let engine: InngestTestEngine
  let send: ReturnType<typeof vi.fn>
  const generate = vi.spyOn(mockImageGen, 'generate')

  const buildEvent = (pointId: string): [{ name: string; data: Record<string, unknown> }] => [
    { name: 'shorts/point.build.requested', data: { projectId: FIXTURE_PROJECT_ID, pointId } },
  ]

  function sentEvents(): { name: string; data: Record<string, unknown> }[] {
    return send.mock.calls.flatMap(([request]) => {
      const { payload } = request as { payload: unknown }
      const list = (Array.isArray(payload) ? payload : [payload]) as {
        name: string
        data: Record<string, unknown>
      }[]
      return list.map(({ name, data }) => ({ name, data }))
    })
  }

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: pointShortRunner })
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    send = vi
      .spyOn(inngest as unknown as { _send: () => unknown }, '_send')
      .mockResolvedValue({ ids: [] }) as unknown as typeof send
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    await db.delete(notices)
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(talkingPointSets)
    await db.delete(scripts)
    await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    await setCredential(db, 'elevenlabs', 'xi-test-key-0000', env.SECRETS_ENCRYPTION_KEY)
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      tts: { provider: 'elevenlabs', voiceId: 'voice-a' },
    })
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'shorts',
      stageStatus: 'running',
      shortsPhase: 'review',
    })
    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1 })
      .returning({ id: scripts.id })
    await db.insert(chapters).values(
      CHAPTER_IDS.map((id, index) => ({
        id,
        scriptId: script!.id,
        index,
        title: `Chapter ${index + 1}`,
        contentMd: CHAPTER_MD,
      })),
    )
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: canonicalMaster(), s3Key: '' })
  })

  it('refuses a project frozen to an incomplete bible before any script prompt is built', async () => {
    const channel = await createChannel(db, {
      name: 'Blank channel',
      handle: null,
      slug: `blank-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    const kase = await createCase(db, { channelId: channel.id, title: 'T', category: 'collapse' })
    const blank = (await createProjectFromCase(db, { caseId: kase.id, title: 'T' })).id
    const [script] = await db
      .insert(scripts)
      .values({ projectId: blank, version: 1 })
      .returning({ id: scripts.id })
    await db.insert(chapters).values(
      CHAPTER_IDS.map((_, index) => ({
        id: `01HQ0000000000000000000B${index}1`,
        scriptId: script!.id,
        index,
        title: `Chapter ${index + 1}`,
        contentMd: CHAPTER_MD,
      })),
    )
    await insertTimeline(db, { projectId: blank, json: canonicalMaster(), s3Key: '' })
    const [first] = (await storeApprovedSet()).slice(0, 1)
    const set = await insertTalkingPointSet(db, {
      projectId: blank,
      scriptVersion: 1,
      points: [first!],
      note: null,
    })
    await approveTalkingPointSet(db, blank, set.version)

    for (const stub of ['1', '']) {
      vi.stubEnv('MOCK_PROVIDERS', stub)
      const { error } = await engine.execute({
        events: [
          {
            name: 'shorts/point.build.requested',
            data: { projectId: blank, pointId: first!.id },
          },
        ],
      })
      expect(error).toMatchObject({ message: FROZEN_BIBLE_INCOMPLETE_MESSAGE })
    }
    expect(callLlm).not.toHaveBeenCalled()
    expect(spies.mockPointScript).not.toHaveBeenCalled()
    expect(spies.mockPointPlan).not.toHaveBeenCalled()
    expect(await listShorts(db, blank)).toHaveLength(0)
  })

  it(
    'builds a point row whose master parses, with five phases and both bridge overlays, then asks for one render',
    { timeout: 180_000 },
    async () => {
      await storeApprovedSet()

      const { result } = await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

      expect(result).toMatchObject({ outcome: 'built' })
      const rows = await listShorts(db, FIXTURE_PROJECT_ID)
      expect(rows).toHaveLength(1)
      const row = rows[0]!
      expect(row).toMatchObject({ kind: 'point', pointId: POINT_IDS[0] })
      expect(row.segmentRef).toEqual({
        chapterId: POINT_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: 4,
      })

      const timeline = TimelineSchema.parse(row.sourceTimeline)
      expect(timeline.narration).toHaveLength(5)
      expect(timeline.overlays.map((overlay) => overlay.kind).sort()).toEqual([
        'relatedArrow',
        'subscribeBadge',
      ])
      expect(timeline.slots.length).toBeGreaterThan(5)

      const script = PointScriptRecordSchema.parse(row.pointScript)
      expect(script.paragraphs.map((p) => p.phase)).toEqual([
        'hook',
        'stakes',
        'delivery',
        'resolution',
        'bridge',
      ])
      expect(row.title).toBe(script.title)
      expect(script.pointId).toBe(POINT_IDS[0])
      expect(PointVoiceRecordSchema.parse(row.pointVoice).paragraphs).toHaveLength(5)
      const plan = PointPlanRecordSchema.parse(row.pointPlan)
      // Nothing is left pending: every shot is a full slot snapshot.
      expect(plan.shots.every((shot) => shot.slot !== null && shot.pending === null)).toBe(true)
      expect(plan.plannedFor.scriptVersion).toBe(1)
      expect(PointFetchesRecordSchema.parse(row.pointFetches).candidates.length).toBeGreaterThan(0)

      const renderEvents = sentEvents().filter((event) => event.name === 'shorts/render.requested')
      expect(renderEvents).toEqual([
        {
          name: 'shorts/render.requested',
          data: { projectId: FIXTURE_PROJECT_ID, shortId: row.id },
        },
      ])
    },
  )

  it(
    'keeps a valid plan and says so when a new still cannot be had',
    { timeout: 180_000 },
    async () => {
      await storeApprovedSet()
      generate.mockRejectedValue(new ValidationError('the model refused that picture'))

      const { result } = await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

      expect(result).toMatchObject({ outcome: 'built' })
      const [row] = await listShorts(db, FIXTURE_PROJECT_ID)
      expect(TimelineSchema.safeParse(row!.sourceTimeline).success).toBe(true)
      const plan = PointPlanRecordSchema.parse(row!.pointPlan)
      expect(plan.shots.every((shot) => shot.slot !== null)).toBe(true)
      const notes = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'short', row!.id)
      expect(notes).toHaveLength(1)
      expect(notes[0]!.message).toMatch(/shot/i)
    },
  )

  it('parks the stage and builds nothing when the budget refuses the build', async () => {
    await storeApprovedSet()
    await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 0, approvedOverage: null } })

    const { result } = await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

    expect(result).toMatchObject({ outcome: 'over-budget' })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(0)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    expect(sentEvents().filter((event) => event.name === 'shorts/render.requested')).toEqual([])
  })

  it('moves the stored segment with the paragraph count when a rebuild saves a script', async () => {
    const existing = await builtRow(POINT_IDS[0]!)
    const script = mockPointScript({
      title: 'T',
      sourceChapters: [0],
      bridgeChapters: [1],
    } as TalkingPoint)
    const longer = {
      ...script,
      paragraphs: [...script.paragraphs, ...script.paragraphs.slice(0, 2)],
      scriptVersion: 1,
      pointId: POINT_IDS[0]!,
    }

    await savePointProgress({
      projectId: FIXTURE_PROJECT_ID,
      pointId: POINT_IDS[0]!,
      script: longer,
    })

    expect((await getShort(db, existing.id))?.segmentRef).toEqual({
      chapterId: POINT_CHAPTER_ID,
      fromParagraph: 0,
      toParagraph: longer.paragraphs.length - 1,
    })
  })

  it('does nothing when the point already has a row', { timeout: 120_000 }, async () => {
    await storeApprovedSet()
    const existing = await builtRow(POINT_IDS[0]!)

    const { result } = await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

    expect(result).toMatchObject({ outcome: 'exists', shortId: existing.id })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(1)
    expect(sentEvents()).toEqual([])
    expect(generate).not.toHaveBeenCalled()
  })

  /** A second run is a new run: a fresh engine, not the first one's memoised steps. */
  const freshRun = (events: [{ name: string; data: Record<string, unknown> }]) =>
    new InngestTestEngine({ function: pointShortRunner }).execute({ events })

  /** Cuts a finished build back to a draft: what a run that died part-way leaves. */
  async function cutBackTo(keep: { voiceParagraphs: number; plan: boolean }) {
    // One Short in the table, so no filter is needed.
    const [row] = await db.select().from(shorts)
    const voice = PointVoiceRecordSchema.parse(row!.pointVoice)
    await db.update(shorts).set({
      sourceTimeline: null,
      pointVoice: { ...voice, paragraphs: voice.paragraphs.slice(0, keep.voiceParagraphs) },
      ...(keep.plan ? {} : { pointPlan: null, pointFetches: null }),
    })
  }

  it(
    'resumes a cut-off build: no new script, voice or plan call for what was bought',
    { timeout: 180_000 },
    async () => {
      await storeApprovedSet()
      await engine.execute({ events: buildEvent(POINT_IDS[0]!) })
      const [first] = await listShorts(db, FIXTURE_PROJECT_ID)
      await cutBackTo({ voiceParagraphs: 5, plan: true })
      vi.clearAllMocks()
      generate.mockClear()

      const { result } = await freshRun(buildEvent(POINT_IDS[0]!))

      expect(result).toMatchObject({ outcome: 'built', shortId: first!.id })
      expect(spies.mockPointScript).not.toHaveBeenCalled()
      expect(spies.synthesise).not.toHaveBeenCalled()
      expect(spies.mockPointPlan).not.toHaveBeenCalled()
      expect(generate).not.toHaveBeenCalled()
      const rows = await listShorts(db, FIXTURE_PROJECT_ID)
      expect(rows).toHaveLength(1)
      expect(TimelineSchema.safeParse(rows[0]!.sourceTimeline).success).toBe(true)
    },
  )

  it(
    'resumes after the script and three voiced paragraphs: voices only the other two, plans once',
    { timeout: 180_000 },
    async () => {
      await storeApprovedSet()
      await engine.execute({ events: buildEvent(POINT_IDS[0]!) })
      const [first] = await listShorts(db, FIXTURE_PROJECT_ID)
      await cutBackTo({ voiceParagraphs: 3, plan: false })
      vi.clearAllMocks()

      const { result } = await freshRun(buildEvent(POINT_IDS[0]!))

      expect(result).toMatchObject({ outcome: 'built', shortId: first!.id })
      expect(spies.mockPointScript).not.toHaveBeenCalled()
      expect(spies.synthesise).toHaveBeenCalledTimes(2)
      expect(spies.mockPointPlan).toHaveBeenCalledTimes(1)
      const stored = await getShort(db, first!.id)
      expect(PointVoiceRecordSchema.parse(stored!.pointVoice).paragraphs).toHaveLength(5)
    },
  )

  it('does not list a draft as a Short, and the stage does not settle on one', async () => {
    await storeApprovedSet()
    await builtRow(POINT_IDS[0]!)
    await builtRow(POINT_IDS[1]!)
    // A draft: the script is saved, nothing more.
    await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'Draft',
      segmentRef: { chapterId: POINT_CHAPTER_ID, fromParagraph: 0, toParagraph: 4 },
      kind: 'point',
      pointId: POINT_IDS[2]!,
    })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(2)

    const { result } = await engine.execute({ events: buildEvent(POINT_IDS[1]!) })

    expect(result).toMatchObject({ outcome: 'exists' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('running')
  })

  it('does nothing at all for a fully assembled point', async () => {
    await storeApprovedSet()
    await builtRow(POINT_IDS[0]!)
    vi.clearAllMocks()

    await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

    expect(spies.mockPointScript).not.toHaveBeenCalled()
    expect(spies.synthesise).not.toHaveBeenCalled()
    expect(spies.mockPointPlan).not.toHaveBeenCalled()
    expect(sentEvents()).toEqual([])
  })

  it(
    'moves the stage to review once every approved point has a Short',
    { timeout: 180_000 },
    async () => {
      await storeApprovedSet()
      await builtRow(POINT_IDS[0]!)
      await builtRow(POINT_IDS[1]!)

      const { result } = await engine.execute({ events: buildEvent(POINT_IDS[2]!) })

      expect(result).toMatchObject({ outcome: 'built', stageReady: true })
      expect(await getProject(db, FIXTURE_PROJECT_ID)).toMatchObject({
        stage: 'shorts',
        stageStatus: 'awaiting_review',
        shortsPhase: 'review',
      })
    },
  )

  it('skips a point whose script cannot be written, with its reason on the Short', async () => {
    await storeApprovedSet()
    await db.delete(scripts)

    const { result } = await engine.execute({ events: buildEvent(POINT_IDS[0]!) })

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(0)
    const notes = noticesFor(
      await listProjectNotices(db, FIXTURE_PROJECT_ID),
      'short',
      POINT_IDS[0]!,
    )
    expect(notes).toEqual([
      expect.objectContaining({ kind: 'skipped', message: expect.stringContaining('no script') }),
    ])
  })

  it('ignores a point the approved set does not hold', async () => {
    await storeApprovedSet()

    const { result } = await engine.execute({ events: buildEvent('01HQ0000000000000000000ZZZ') })

    expect(result).toMatchObject({ outcome: 'unknown-point' })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(0)
  })
})

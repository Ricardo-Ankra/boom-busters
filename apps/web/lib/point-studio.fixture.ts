import {
  approveTalkingPointSet,
  chapters,
  FIXTURE_PROJECT_ID,
  insertTalkingPointSet,
  insertTimeline,
  scripts,
  setProjectStage,
} from '@boom-busters/db'
import { mockPointScript, mockTalkingPoints } from '@boom-busters/providers'
import {
  DEFAULT_SETTINGS,
  PointScriptRecordSchema,
  resolveBrandKit,
  teaserTextHash,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { PointVoiceRecord, TalkingPoint, Timeline } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import {
  assemblePointShort,
  BRIDGE_LABEL,
  countNewPictures,
  fetchPendingShots,
  planPointShots,
  savePointShort,
} from '@/inngest/lib/point-build'

/**
 * Shared seed for the point Short studio's tests (model, actions, runner): a
 * three-chapter script, a master timeline, one approved talking point and one
 * assembled `point` Short built through the real build functions in
 * mock-provider mode. Test-only; callers reset the tables first and stub
 * `MOCK_PROVIDERS` and `@/lib/storage` themselves.
 */

export const CHAPTER_IDS = [
  '01HQ0000000000000000000CH1',
  '01HQ0000000000000000000CH2',
  '01HQ0000000000000000000CH3',
]
export const POINT_ID = '01HQ0000000000000000000P01'

const CHAPTER_MD =
  'By June, the auditors could not find the money.\n\nEY refused to sign the accounts.'

export function canonicalMaster(): Timeline {
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

/** The long form's script (version 1) and its master, ready for a Short to be built from. */
export async function seedLongForm(scriptVersion = 1): Promise<void> {
  const [script] = await db
    .insert(scripts)
    .values({ projectId: FIXTURE_PROJECT_ID, version: scriptVersion })
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
}

/** One approved talking point, stamped as written from script version 1. */
export async function seedApprovedPoint(): Promise<TalkingPoint> {
  const [draft] = mockTalkingPoints(
    [0, 1, 2].map((index) => ({ index, title: `Chapter ${index + 1}`, contentMd: CHAPTER_MD })),
  )
  const point: TalkingPoint = {
    ...draft!,
    id: POINT_ID,
    sourceChapters: [0],
    bridgeChapters: [1, 2],
    order: 1,
  }
  const set = await insertTalkingPointSet(db, {
    projectId: FIXTURE_PROJECT_ID,
    scriptVersion: 1,
    points: [point],
    note: null,
  })
  await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, set.version)
  return point
}

/** A voice record for a script, every paragraph `durationMs` long, as the build stores it. */
export function voiceFor(
  paragraphs: readonly { text: string }[],
  scriptVersion = 1,
  durationMs = 10_000,
): PointVoiceRecord {
  return {
    scriptVersion,
    paragraphs: paragraphs.map((paragraph, index) => ({
      textHash: teaserTextHash(paragraph.text),
      r2Key: `mock://voice/point-${index}.wav`,
      durationMs,
      wordTimings: null,
    })),
  }
}

/**
 * The whole fixture: long form, approved point and one assembled point Short.
 * Returns the Short's id. Needs `MOCK_PROVIDERS=1` and the storage module
 * mocked to the regenerated path.
 */
export async function seedPointShort(): Promise<{ shortId: string; point: TalkingPoint }> {
  await setProjectStage(db, FIXTURE_PROJECT_ID, {
    stage: 'shorts',
    stageStatus: 'awaiting_review',
    shortsPhase: 'review',
  })
  await seedLongForm()
  const point = await seedApprovedPoint()

  const script = PointScriptRecordSchema.parse({
    ...mockPointScript(point),
    scriptVersion: 1,
    pointId: point.id,
  })
  const voice = voiceFor(script.paragraphs)
  const master = canonicalMaster()
  const planned = await planPointShots(FIXTURE_PROJECT_ID, {
    script,
    voice,
    master,
    sourceChapters: point.sourceChapters,
    note: null,
  })
  if (!planned.ok) throw new Error('the fixture plan could not be made')
  const fetched = await fetchPendingShots(FIXTURE_PROJECT_ID, planned.plan)
  if (!fetched.ok) throw new Error('the fixture pictures could not be fetched')
  const { timeline } = assemblePointShort({
    master,
    script,
    voice,
    plan: fetched.plan,
    bridge: { label: BRIDGE_LABEL, channelName: 'Boom & Busters', handle: '@boomandbusters' },
    newImageCount: countNewPictures(fetched.plan, fetched.fetches),
  })
  const saved = await savePointShort({
    projectId: FIXTURE_PROJECT_ID,
    pointId: point.id,
    script,
    voice,
    plan: fetched.plan,
    fetches: fetched.fetches,
    timeline,
  })
  return { shortId: saved.shortId, point }
}

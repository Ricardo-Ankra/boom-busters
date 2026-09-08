// @vitest-environment node

import {
  chapters,
  FIXTURE_PROJECT_ID,
  getProject,
  getShort,
  insertShort,
  insertTimeline,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  setCredential,
  shorts,
  timelines,
  truncateRunMirror,
  updateSettings,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { teaserRebuildRunner } from './teaser-rebuild-runner'

/**
 * The teaser-rebuild-runner against the real database (decision 227): the
 * studio's Re-voice & recut. What matters here: an edited stored script is
 * re-voiced and recut in place with the render pointer nulled; a pre-studio
 * teaser with no stored script gets one regenerated and stored; and a
 * refusal (no voice chosen) notifies instead of touching the project stage.
 */

vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'

const CHAPTER_MD =
  'By June, the auditors could not find the money.\n\n' +
  'EY refused to sign the accounts.\n\n' +
  'The shares collapsed in nine days.'

function canonicalMaster(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [0, 1, 2].map((index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 6000,
      durationMs: 6000,
      chapterId: CHAPTER,
      paragraphIndex: index,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 18_000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
      },
    ],
    overlays: [],
  }
}

function rebuildEvent(shortId: string): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'teaser/rebuild.requested',
      data: { projectId: FIXTURE_PROJECT_ID, shortId },
    },
  ]
}

const STORED_SCRIPT = {
  title: 'The audit that said no',
  paragraphs: [
    { text: 'One number was missing, and it was billions.', chapterIndex: 0 },
    { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 0 },
  ],
  scriptVersion: 1,
}

async function chooseVoice(): Promise<void> {
  await updateSettings(db, {
    tts: { provider: 'elevenlabs', voiceId: 'mock-narrator' },
    budgets: { monthlyCeilingUsd: 100, approvedOverage: null },
  })
  await setCredential(
    db,
    'elevenlabs',
    'mock-key-for-tests',
    process.env['SECRETS_ENCRYPTION_KEY']!,
  )
}

async function insertTeaser(overrides: { teaserScript?: Record<string, unknown> } = {}) {
  return insertShort(db, {
    projectId: FIXTURE_PROJECT_ID,
    title: 'Curated by hand',
    segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 1 },
    kind: 'teaser',
    ...(overrides.teaserScript !== undefined ? { teaserScript: overrides.teaserScript } : {}),
  })
}

describeDb('teaser-rebuild-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: teaserRebuildRunner })
    vi.clearAllMocks()
    await seed(db)
    // Seeding never resets settings; start voiceless so each test opts in.
    await updateSettings(db, { tts: { provider: 'elevenlabs', voiceId: '' } })
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(scripts)

    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1, shortsCandidates: [] })
      .returning({ id: scripts.id })
    await db.insert(chapters).values({
      id: CHAPTER,
      scriptId: script!.id,
      index: 0,
      title: 'The audit',
      contentMd: CHAPTER_MD,
    })
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: canonicalMaster(), s3Key: '' })
  })

  it(
    're-voices the stored script and recuts in place, nulling the render',
    { timeout: 120_000 },
    async () => {
      await chooseVoice()
      const teaser = await insertTeaser({ teaserScript: STORED_SCRIPT })

      const { result } = await engine.execute({
        events: rebuildEvent(teaser.id),
        steps: [{ id: 'request-render', handler: () => undefined }],
      })

      expect(result).toMatchObject({ outcome: 'rebuilt', beats: 2 })
      const stored = await getShort(db, teaser.id)
      expect(stored?.renderId).toBeNull()
      expect(stored?.title).toBe('Curated by hand')
      const mini = stored?.sourceTimeline as { narration: unknown[]; slots: unknown[] }
      expect(mini.narration).toHaveLength(2)
      expect(mini.slots).toHaveLength(2)
      expect(stored?.segmentRef).toMatchObject({
        chapterId: TEASER_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: 1,
      })
      // Not a stage runner: the project's stage is not this run's to touch.
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stage).not.toBe('failed')
    },
  )

  it(
    'a pre-studio teaser with no stored script gets one regenerated and stored',
    { timeout: 120_000 },
    async () => {
      await chooseVoice()
      const teaser = await insertTeaser()

      const { result } = await engine.execute({
        events: rebuildEvent(teaser.id),
        steps: [{ id: 'request-render', handler: () => undefined }],
      })

      expect(result).toMatchObject({ outcome: 'rebuilt' })
      const stored = await getShort(db, teaser.id)
      const script = stored?.teaserScript as { paragraphs: unknown[]; scriptVersion: number } | null
      expect(script).not.toBeNull()
      expect(script!.paragraphs.length).toBeGreaterThanOrEqual(2)
      expect(stored?.sourceTimeline).not.toBeNull()
    },
  )

  it('a refusal notifies and stops — the stage is never failed', { timeout: 120_000 }, async () => {
    // No voice chosen: synthesis refuses before spending.
    const teaser = await insertTeaser({ teaserScript: STORED_SCRIPT })
    const before = (await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus

    const { result } = await engine.execute({ events: rebuildEvent(teaser.id) })

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'run-failed', title: expect.stringContaining('teaser') }),
    )
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe(before)
    // The old cut is kept: a failed rebuild must not leave a half-teaser.
    expect((await getShort(db, teaser.id))?.teaserScript).toMatchObject({ scriptVersion: 1 })
  })
})

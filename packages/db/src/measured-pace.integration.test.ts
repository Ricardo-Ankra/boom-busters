import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createChannel } from './channels'
import { createDb } from './client'
import { measuredPace } from './measured-pace'
import { createProjectFromCase } from './projects'
import { createScriptVersion, saveChapter } from './scripts'
import { requireTestDatabase } from './test-database'
import { claimTake, storeTakeAudio } from './voice'

/** The pace the channel's voice actually spoke at, against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('measuredPace', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''
  let otherId = ''

  const newChannel = async (slug: string) =>
    (
      await createChannel(db, {
        name: slug,
        handle: null,
        slug,
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      })
    ).id

  /** One stored take of `words` timed words over `durationMs`, in a new project of the channel. */
  async function take(
    forChannel: string,
    words: number | null,
    durationMs: number | null,
    paragraphIndex = 0,
  ) {
    const kase = await createCase(db, { channelId: forChannel, title: 'Case', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Project' })
    const script = await createScriptVersion(db, project.id)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'Chapter',
      contentMd: 'One.',
      estRuntimeSec: 1,
    })
    const claimed = await claimTake(db, {
      projectId: project.id,
      chapterId: chapter.id,
      paragraphIndex,
      idempotencyKey: `k-${project.id}`,
      provider: 'elevenlabs',
      voiceId: 'v',
      builtFromScriptVersion: 1,
    })
    if (claimed.kind !== 'claimed' || durationMs === null) return
    await storeTakeAudio(db, claimed.take.id, {
      r2Key: 'k',
      durationMs,
      costUsd: 0,
      waveform: [],
      timings:
        words === null
          ? null
          : Array.from({ length: words }, (_, i) => ({
              text: 'w',
              startMs: i * 10,
              endMs: i * 10 + 10,
            })),
    })
  }

  beforeEach(async () => {
    await truncateCases(db)
    channelId = await newChannel(`pace-${Date.now()}-a`)
    otherId = await newChannel(`pace-${Date.now()}-b`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('is null when no take has timings and a duration', async () => {
    await take(channelId, null, 5_000)
    expect(await measuredPace(db, channelId)).toBeNull()
  })

  it("is the takes' words over their voiced minutes, rounded, from the channel's takes only", async () => {
    // 46 words in 20 s = 138 wpm; the other channel's take is not counted.
    await take(channelId, 23, 10_000)
    await take(channelId, 23, 10_000)
    await take(otherId, 100, 10_000)
    expect(await measuredPace(db, channelId)).toEqual({ wordsPerMinute: 138, takes: 2 })
  })

  it('draws on the latest takes up to the limit', async () => {
    await take(channelId, 10, 10_000)
    await take(channelId, 40, 10_000)
    expect(await measuredPace(db, channelId, 1)).toEqual({ wordsPerMinute: 240, takes: 1 })
  })
})

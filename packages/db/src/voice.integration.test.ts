import { takeIdempotencyKey } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { createScriptVersion, saveChapter } from './scripts'
import { requireTestDatabase } from './test-database'
import {
  approveCurrentTakes,
  AUDITION_CACHE_LIMIT,
  claimTake,
  currentTake,
  findAudition,
  flagTake,
  latestScriptParagraphSources,
  listAuditions,
  listVoiceTakes,
  saveAudition,
  storeTakeAudio,
  unflagTake,
} from './voice'

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('voice takes', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''
  let chapterId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    const source = await createCase(db, { title: 'Wirecard', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Wirecard' })
    projectId = project.id
    const script = await createScriptVersion(db, projectId)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One paragraph.\n\nAnd a second.',
      estRuntimeSec: 30,
    })
    chapterId = chapter.id
  })

  function key(paragraphIndex = 0, text = 'One paragraph.'): string {
    return takeIdempotencyKey({
      projectId,
      chapterId,
      paragraphIndex,
      text,
      voiceId: 'Charon',
    })
  }

  function claim(paragraphIndex = 0, text = 'One paragraph.', takeNumber?: number) {
    return claimTake(db, {
      projectId,
      chapterId,
      paragraphIndex,
      idempotencyKey: key(paragraphIndex, text),
      provider: 'gemini',
      voiceId: 'Charon',
      builtFromScriptVersion: 1,
      ...(takeNumber === undefined ? {} : { takeNumber }),
    })
  }

  const audio = {
    r2Key: 'boom-busters/voice/x.wav',
    durationMs: 4200,
    costUsd: 0.0021,
    waveform: [0, 50, 100],
  }

  it('claims a pending row before anything is bought', async () => {
    const result = await claim()

    expect(result.kind).toBe('claimed')
    expect(result.take.status).toBe('pending')
    expect(result.take.r2Key).toBeNull()
    expect(result.take.takeNumber).toBe(1)
  })

  /**
   * Gemini is a Google model line, not a vendor: its TTS endpoint takes the
   * same key and bills the same account, so narration spend has to land under
   * the cap that key already has.
   */
  it('stores Gemini narration against the Google account', async () => {
    expect((await claim()).take.provider).toBe('google')
  })

  it('hands back existing audio instead of buying it twice', async () => {
    const first = await claim()
    await storeTakeAudio(db, first.take.id, audio)

    const again = await claim()
    expect(again.kind).toBe('existing')
    expect(again.take.id).toBe(first.take.id)
    expect(again.take.r2Key).toBe(audio.r2Key)
  })

  /**
   * A run that died between claiming and storing has to be resumable. Treating
   * an unfilled row as "already bought" would leave the paragraph silent
   * forever with a row insisting otherwise.
   */
  it('re-claims an unfilled row rather than treating it as bought', async () => {
    const first = await claim()
    const again = await claim()

    expect(again.kind).toBe('claimed')
    expect(again.take.id).toBe(first.take.id)
    expect(await listVoiceTakes(db, projectId)).toHaveLength(1)
  })

  it('treats edited text as a different paragraph to narrate', async () => {
    await storeTakeAudio(db, (await claim()).take.id, audio)
    const edited = await claim(0, 'One paragraph, revised.')

    expect(edited.kind).toBe('claimed')
    expect(await listVoiceTakes(db, projectId)).toHaveLength(2)
  })

  it('stamps the script version it was read from', async () => {
    expect((await claim()).take.builtFromScriptVersion).toBe(1)
  })

  it('fills a claimed take with audio, its duration and its waveform', async () => {
    const stored = await storeTakeAudio(db, (await claim()).take.id, audio)

    expect(stored.status).toBe('generated')
    expect(stored.durationMs).toBe(4200)
    expect(stored.waveform).toEqual([0, 50, 100])
    expect(Number(stored.costUsd)).toBeCloseTo(0.0021, 6)
  })

  describe('retakes', () => {
    it('keeps the take it replaces, so the A/B toggle has something to compare', async () => {
      const first = await claim()
      await storeTakeAudio(db, first.take.id, audio)
      await flagTake(db, first.take.id, 'Swallowed the word "insolvency".')

      const retake = await claim(0, 'One paragraph.', 2)
      await storeTakeAudio(db, retake.take.id, { ...audio, r2Key: 'take-2.wav' })

      const all = await listVoiceTakes(db, projectId)
      expect(all).toHaveLength(2)
      expect(all.map((take) => take.takeNumber)).toEqual([1, 2])
    })

    it('makes the highest take number the current one', async () => {
      await storeTakeAudio(db, (await claim()).take.id, audio)
      const retake = await claim(0, 'One paragraph.', 2)

      expect((await currentTake(db, { chapterId, paragraphIndex: 0 }))?.id).toBe(retake.take.id)
    })

    it('carries the note on the take it belongs to', async () => {
      const first = await claim()
      const flagged = await flagTake(db, first.take.id, 'Mispronounced Wirecard.')

      expect(flagged.status).toBe('flagged')
      expect(flagged.note).toBe('Mispronounced Wirecard.')
    })

    it('clears a flag without buying a replacement', async () => {
      const first = await claim()
      await storeTakeAudio(db, first.take.id, audio)
      await flagTake(db, first.take.id, 'Second thoughts.')

      const cleared = await unflagTake(db, first.take.id)
      expect(cleared.status).toBe('generated')
      expect(cleared.note).toBeNull()
    })

    it('refuses to unflag a take that is not flagged', async () => {
      const first = await claim()
      await expect(unflagTake(db, first.take.id)).rejects.toThrow('not flagged')
    })
  })

  describe('approving at the gate', () => {
    it('approves the current take of each paragraph and leaves the superseded ones', async () => {
      const first = await claim(0)
      await storeTakeAudio(db, first.take.id, audio)
      const retake = await claim(0, 'One paragraph.', 2)
      await storeTakeAudio(db, retake.take.id, audio)
      const second = await claim(1, 'And a second.')
      await storeTakeAudio(db, second.take.id, audio)

      expect(await approveCurrentTakes(db, projectId)).toBe(2)

      const byId = new Map((await listVoiceTakes(db, projectId)).map((t) => [t.id, t.status]))
      expect(byId.get(retake.take.id)).toBe('approved')
      expect(byId.get(second.take.id)).toBe('approved')
      // The take that lost the comparison is not what will be assembled.
      expect(byId.get(first.take.id)).toBe('generated')
    })
  })

  describe('latestScriptParagraphSources', () => {
    it('returns the chapters of the newest script version, in order', async () => {
      const sources = await latestScriptParagraphSources(db, projectId)

      expect(sources.scriptVersion).toBe(1)
      expect(sources.chapters.map((c) => c.title)).toEqual(['The audit'])
    })

    it('is empty rather than throwing when there is no script at all', async () => {
      const source = await createCase(db, { title: 'Nothing', category: 'collapse' })
      const bare = await createProjectFromCase(db, { caseId: source.id, title: 'Nothing' })

      expect(await latestScriptParagraphSources(db, bare.id)).toEqual({
        scriptVersion: 0,
        chapters: [],
      })
    })
  })

  it('cascades takes away with the project', async () => {
    await claim()
    await sql`delete from projects where id = ${projectId}`
    expect(await listVoiceTakes(db, projectId)).toHaveLength(0)
  })
})

suite('audition cache', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql`delete from voice_auditions`
  })

  const sample = {
    provider: 'google-cloud-tts' as const,
    voiceId: 'en-GB-Chirp3-HD-Achernar',
    sampleHash: 'abc',
  }

  it('is empty before a voice has read the sample', async () => {
    expect(await findAudition(db, sample)).toBeUndefined()
  })

  /**
   * The whole point: leaving Settings and coming back must not cost anything.
   * The panel's in-memory cache dies with the page, which is exactly the moment
   * you want to return and compare two candidates.
   */
  it('hands the same audio back rather than charging for it again', async () => {
    await saveAudition(db, { ...sample, audioBase64: 'UklGRg==', durationMs: 4200, costUsd: 0.002 })

    const found = await findAudition(db, sample)
    expect(found?.audioBase64).toBe('UklGRg==')
    expect(found?.durationMs).toBe(4200)
  })

  it('treats a different sample as a different audition', async () => {
    await saveAudition(db, { ...sample, audioBase64: 'a', durationMs: 1, costUsd: 0 })
    expect(await findAudition(db, { ...sample, sampleHash: 'different' })).toBeUndefined()
  })

  it('treats a different voice as a different audition', async () => {
    await saveAudition(db, { ...sample, audioBase64: 'a', durationMs: 1, costUsd: 0 })
    expect(await findAudition(db, { ...sample, voiceId: 'en-GB-Chirp3-HD-Achird' })).toBeUndefined()
  })

  it('replaces rather than duplicating when the same audition is re-bought', async () => {
    await saveAudition(db, { ...sample, audioBase64: 'first', durationMs: 1, costUsd: 0 })
    await saveAudition(db, { ...sample, audioBase64: 'second', durationMs: 2, costUsd: 0 })

    expect((await findAudition(db, sample))?.audioBase64).toBe('second')
    expect(await listAuditions(db, 'abc')).toHaveLength(1)
  })

  it('lists everything bought for one sample, so the panel opens with it', async () => {
    await saveAudition(db, { ...sample, audioBase64: 'a', durationMs: 1, costUsd: 0 })
    await saveAudition(db, {
      ...sample,
      voiceId: 'en-GB-Chirp3-HD-Achird',
      audioBase64: 'b',
      durationMs: 1,
      costUsd: 0,
    })

    expect(await listAuditions(db, 'abc')).toHaveLength(2)
  })

  it('stores Gemini auditions against the Google account, as takes do', async () => {
    await saveAudition(db, {
      provider: 'gemini',
      voiceId: 'Charon',
      sampleHash: 'abc',
      audioBase64: 'a',
      durationMs: 1,
      costUsd: 0,
    })

    const [row] = await listAuditions(db, 'abc')
    expect(row?.provider).toBe('google')
    // And is found again through the TTS provider it was saved under.
    expect(
      await findAudition(db, { provider: 'gemini', voiceId: 'Charon', sampleHash: 'abc' }),
    ).toBeDefined()
  })

  it('prunes the oldest once the cache is full', async () => {
    // A cache that only grows is a cache nobody remembers to empty. The limit
    // is injected so this costs five round trips rather than a hundred and
    // twenty-five; the shipped default is asserted separately below.
    for (let i = 0; i < 5; i += 1) {
      await saveAudition(
        db,
        { ...sample, voiceId: `voice-${i}`, audioBase64: 'a', durationMs: 1, costUsd: 0 },
        3,
      )
    }

    const kept = await listAuditions(db, 'abc')
    expect(kept).toHaveLength(3)
    // The newest survive, which is what makes a comparison you are mid-way
    // through keep working.
    expect(kept.map((row) => row.voiceId).sort()).toEqual(['voice-2', 'voice-3', 'voice-4'])
  })

  it('keeps more than one provider’s catalogue by default', () => {
    // 33 Chirp voices, and room for a second provider beside them.
    expect(AUDITION_CACHE_LIMIT).toBeGreaterThan(100)
  })
})

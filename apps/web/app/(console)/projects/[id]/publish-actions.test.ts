// @vitest-environment node

import {
  createScriptVersion,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  insertTimeline,
  publishRecords,
  requireTestDatabase,
  saveChapter,
  scripts,
  seed,
  timelines,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { generateDescription, generateTitles, savePublishDraft } from './publish-actions'

/**
 * The Generate titles button (decision 293) against the test database: at
 * most two calls, so a cut-off answer is asked once more at double the
 * budget, and half a list of titles is never offered.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

/** A one-chapter master: enough for the description to gloss one chapter. */
function masterTimeline(chapterId: string): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [0, 1].map((index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 6000,
      durationMs: 6000,
      chapterId,
      paragraphIndex: index,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 12_000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
      },
    ],
    overlays: [],
  }
}

const HALF = '{"titles": ["The audit that said no to the mon'
const WHOLE = JSON.stringify({
  titles: ['The audit that said no to the money', 'Nine days from a record high to nothing'],
})

describeDb('generateTitles (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    // A record another suite scheduled would refuse the edit.
    await db.delete(publishRecords)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the titles are cut off, and offers none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: HALF, truncated: true })
      .mockResolvedValueOnce({ text: WHOLE })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, estimateOutputTokens: 500 })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'retry: cut off' })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      titleOptions: [
        'The audit that said no to the money',
        'Nine days from a record high to nothing',
      ],
    })
  })

  it('stops after a second cut-off with the reason, and offers nothing', async () => {
    callLlm.mockResolvedValue({ text: HALF, truncated: true })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      error: 'The titles could not be generated: the answer was cut off at its length limit',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).not.toHaveProperty(
      'titleOptions',
    )
  })
})

/**
 * Decision 301: titles are grounded in the claim list; the search description
 * is written from the claims and the script, stamped with the script version
 * it was written for; and an opening the owner rewrites is stamped too.
 */
describeDb('the search description (decision 301)', () => {
  const DESCRIPTION = JSON.stringify({
    body: 'How Wirecard, the German payments company, collapsed in June 2020.',
    chapterGlosses: ['The trustee accounts that never existed'],
    hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
    tags: ['Wirecard', 'Markus Braun'],
  })

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await db.delete(publishRecords)
    await db.delete(timelines)
    await db.delete(scripts)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: '[pause] EY refused to sign the accounts.\n\nThe shares collapsed in nine days.',
      estRuntimeSec: 12,
    })
    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: masterTimeline(chapter.id),
      s3Key: '',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('grounds the titles in the claim list', async () => {
    callLlm.mockResolvedValueOnce({ text: WHOLE })
    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    const request = callLlm.mock.calls[0]![0] as { system: string; messages: { content: string }[] }
    expect(request.system).toMatch(/early pitch/)
    expect(request.messages.map((m) => m.content).join('\n')).toContain(
      'Wirecard AG filed for insolvency',
    )
  })

  it('writes the opening, the chapter glosses, the hashtags and tags, stamped with the script version', async () => {
    await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: '',
      tags: 'Owner tag',
    })
    callLlm.mockResolvedValueOnce({ text: DESCRIPTION })

    expect(await generateDescription('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const request = callLlm.mock.calls[0]![0] as { messages: { content: string }[] }
    const sent = request.messages.map((m) => m.content).join('\n')
    expect(sent).toContain('1. The audit')
    expect(sent).toContain('Wirecard AG filed for insolvency')
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      descriptionBody: 'How Wirecard, the German payments company, collapsed in June 2020.',
      bodyScriptVersion: 1,
      chapterGlosses: ['The trustee accounts that never existed'],
      hashtags: ['#Wirecard', '#Fraud', '#Documentary'],
      // The owner's tag is kept, first; the written ones join it.
      tags: ['Owner tag', 'Wirecard', 'Markus Braun'],
    })
  })

  it('stamps an opening the owner rewrites, and leaves the stamp when only the tags change', async () => {
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: 'My own opening.',
      tags: '',
    })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      bodyScriptVersion: 1,
    })
    await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await savePublishDraft('master', FIXTURE_PROJECT_ID, {
      title: '',
      descriptionBody: 'My own opening.',
      tags: 'one more',
      hashtags: '#Wirecard, AI Documentary',
      chapterGlosses: ['  The audit that said no  '],
    })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      bodyScriptVersion: 1,
      hashtags: ['#Wirecard', '#AIDocumentary'],
      chapterGlosses: ['The audit that said no'],
    })
  })
})

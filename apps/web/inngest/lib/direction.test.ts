// @vitest-environment node

import {
  createScriptVersion,
  deleteCastMember,
  FIXTURE_PROJECT_ID,
  getProject,
  insertCastMember,
  listCastMembers,
  requireTestDatabase,
  saveChapter,
  seed,
  setCastPhotos,
  setProjectDirection,
  setScriptOutline,
} from '@boom-busters/db'
import { MAX_OUTPUT_TOKENS, mockDirectorsBook } from '@boom-busters/providers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  draftDirectorsBook,
  loadDirectionInputs,
  loadOrDraftDirectorsBook,
  planChapterSlots,
} from './direction'
import type { TimedParagraph } from './shot-list'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

/**
 * The direction helpers against the real database, in mock-provider mode
 * (decision 252): the outline's tension fields reach the prompt inputs, a
 * book is drafted once, and an owner-edited book is reused rather than
 * overwritten.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('direction helpers (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'First paragraph.\n\n[long pause]\n\nSecond paragraph.',
      estRuntimeSec: 30,
    })
    await setScriptOutline(db, script.id, {
      centralQuestion: 'Where was the money?',
      chapters: [
        { title: 'The audit', beat: 'x'.repeat(30), withhold: 'The trustee', targetWords: 300 },
      ],
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drafts the cast into the book as likeness principals (decision 253)', async () => {
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    const inputs = await loadDirectionInputs(FIXTURE_PROJECT_ID)
    expect(inputs.cast).toEqual([{ name: 'Emad Mostaque', role: 'Founder', identityString: '' }])
    // No photograph yet, so nothing for the shot list to treat as photographed.
    expect(inputs.photographed).toEqual([])
    const book = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(book.principals[0]).toMatchObject({ name: 'Emad Mostaque', depiction: 'likeness' })
  })

  it('seeds the cast from the principals a live draft names (decision 253 (j))', async () => {
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    // The mock book carries only an anonymous principal, so this test plays
    // the live route: the model's answer is a book that names two people.
    vi.stubEnv('MOCK_PROVIDERS', '')
    const answer = mockDirectorsBook({
      caseTitle: 'Stability AI',
      chapterCount: 1,
      cast: [
        { name: 'Emad Mostaque', role: 'Founder', identityString: 'oval face, short dark hair' },
        { name: 'Prem Akkaraju', role: 'CEO from 2024', identityString: '' },
      ],
    })
    callLlm.mockResolvedValueOnce({ text: JSON.stringify(answer) })

    const book = await draftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(book.principals.map((p) => p.name)).toContain('[mock] The chief executive')

    const cast = await listCastMembers(db, FIXTURE_PROJECT_ID)
    expect(cast.map((m) => m.name)).toEqual(['Emad Mostaque', 'Prem Akkaraju'])
    expect(cast[0]).toMatchObject({
      role: 'Founder',
      identityString: 'oval face, short dark hair',
      guardrail: '[mock] never handling cash; never in handcuffs; never mocked',
      photos: [],
    })
    // The anonymous principal is not a person the producer can photograph.
    expect(cast.map((m) => m.name)).not.toContain('[mock] The chief executive')

    // Drafting again adds nobody twice.
    callLlm.mockResolvedValueOnce({ text: JSON.stringify(answer) })
    await draftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(await listCastMembers(db, FIXTURE_PROJECT_ID)).toHaveLength(2)
  })

  it('names the photographed cast for the shot list, and only them', async () => {
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Prem Akkaraju',
      role: 'CEO',
    })
    await setCastPhotos(db, emad.id, [
      {
        r2Key: `boom-busters/cast/${FIXTURE_PROJECT_ID}/aaa.jpg`,
        contentHash: 'aaa',
        mimeType: 'image/jpeg',
        width: 1000,
        height: 1200,
        view: 'front',
      },
    ])

    const inputs = await loadDirectionInputs(FIXTURE_PROJECT_ID)
    // Both are cast; only the one with a photograph may have his written
    // description withheld from the prompt (decision 253, amended).
    expect(inputs.cast.map((member) => member.name)).toEqual(['Emad Mostaque', 'Prem Akkaraju'])
    expect(inputs.photographed).toEqual(['Emad Mostaque'])
  })

  it('reads the outline tension fields and splits paragraphs, skipping bare tags', async () => {
    const inputs = await loadDirectionInputs(FIXTURE_PROJECT_ID)
    expect(inputs.centralQuestion).toBe('Where was the money?')
    expect(inputs.chapters[0]?.withhold).toBe('The trustee')
    expect(inputs.chapters[0]?.paragraphs).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(inputs.styleAnchors).toContain('grain')
  })

  it('drafts a mock book once and reuses the stored one after', async () => {
    const first = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(first.chapters).toHaveLength(1)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      motifs: first.motifs,
    })

    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...first,
      visualThesis: 'edited by the owner',
    })
    const second = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(second.visualThesis).toBe('edited by the owner')
  })
})

describe('planChapterSlots against a live model', () => {
  /**
   * A shot list cut off at max_tokens is deterministic for a given budget, so
   * an Inngest retry that replays the same request buys the same failure. The
   * one retry worth making is a bigger one (decision 252, first live run).
   */
  const PARAGRAPHS: TimedParagraph[] = [
    {
      chapterId: 'ch-1',
      index: 0,
      text: 'By June, the auditors could not find it.',
      startMs: 0,
      durationMs: 9000,
    },
  ]
  const PLAN = JSON.stringify({
    slots: [
      {
        paragraphIndex: 0,
        seconds: 9,
        brief: {
          type: 'stock',
          coversText: 'By June, the auditors could not find it.',
          description: 'An empty audit office at dusk.',
          shotSize: 'wide',
          query: 'empty office dusk',
          rejectionCriteria: [],
          motion: { kind: 'static' },
          transition: 'cut',
        },
      },
    ],
  })

  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('retries a cut-off shot list once with double the budget, then plans from the answer', async () => {
    callLlm
      .mockResolvedValueOnce({
        text: '```json\n{ "slots": [ { "paragraphIndex": 0, "seconds": 9, "brief": {',
      })
      .mockResolvedValueOnce({ text: PLAN })

    const result = await planChapterSlots({
      projectId: FIXTURE_PROJECT_ID,
      caseTitle: 'Wirecard',
      chapter: { id: 'ch-1', title: 'The audit', number: 1 },
      paragraphs: PARAGRAPHS,
      claims: [],
      claimIds: [],
      styleAnchors: 'a',
      direction: null,
    })

    expect(result.rows).toHaveLength(1)
    expect(callLlm).toHaveBeenCalledTimes(2)
    const first = callLlm.mock.calls[0]?.[0]?.maxTokens ?? 0
    const second = callLlm.mock.calls[1]?.[0]?.maxTokens ?? 0
    expect(second).toBe(Math.min(MAX_OUTPUT_TOKENS, first * 2))
  })

  it('gives up after the bigger retry is cut off too, with the truncation error', async () => {
    callLlm.mockResolvedValue({ text: '{ "slots": [ {' })

    await expect(
      planChapterSlots({
        projectId: FIXTURE_PROJECT_ID,
        caseTitle: 'Wirecard',
        chapter: { id: 'ch-1', title: 'The audit', number: 1 },
        paragraphs: PARAGRAPHS,
        claims: [],
        claimIds: [],
        styleAnchors: 'a',
        direction: null,
      }),
    ).rejects.toThrow(/cut off mid-answer/)
    expect(callLlm).toHaveBeenCalledTimes(2)
  })
})

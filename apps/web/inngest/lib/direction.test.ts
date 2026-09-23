// @vitest-environment node

import {
  createScriptVersion,
  deleteCastMember,
  deleteProjectSet,
  FIXTURE_PROJECT_ID,
  getProject,
  insertCastMember,
  insertProjectSet,
  listCastMembers,
  listProjectSets,
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
    // Sets from an earlier test are not this test's business.
    for (const set of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      await deleteProjectSet(db, set.id)
    }
    // A dismissed row still occupies the (project, name) unique index, and
    // `seedSetsFromLocations` checks the name against EVERY row for the
    // project, live or dismissed (the producer's removals stick), so a
    // leftover dismissed "[mock] Headquarters" from an earlier run of this
    // suite would silently block reseeding. Revive, then hard-delete.
    const revived = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: '[mock] Headquarters',
    })
    await deleteProjectSet(db, revived.id)
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

  it('drafting the book seeds a set for each of its locations (decision 264)', async () => {
    await draftDirectorsBook(FIXTURE_PROJECT_ID)
    const sets = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(sets.map((set) => set.name)).toEqual(['[mock] Headquarters'])
    expect(sets[0]?.look).toBe('[mock] glass box on a business park, grey sky')
  })

  it('a second draft does not duplicate the sets', async () => {
    await draftDirectorsBook(FIXTURE_PROJECT_ID)
    await draftDirectorsBook(FIXTURE_PROJECT_ID)
    const sets = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(sets).toHaveLength(1)
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

  it('reusing a stored book still seeds its locations as sets (decision 265)', async () => {
    // The live project's book was drafted before sets existed. A re-run of
    // the stage reuses that book, so the seeding must happen on this path
    // as well, or the film never gets its rooms without a re-plan.
    const book = await draftDirectorsBook(FIXTURE_PROJECT_ID)
    for (const set of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      await deleteProjectSet(db, set.id)
    }
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...book,
      locations: [
        { name: 'Stability AI London Headquarters', look: 'An open-plan office at night.' },
        { name: 'The Server Hall', look: 'Rows of black racks under strip lights.' },
      ],
    })

    await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)

    const sets = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(sets.map((set) => set.name)).toEqual([
      'Stability AI London Headquarters',
      'The Server Hall',
    ])
    // And again: a second reuse adds nothing twice.
    await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(await listProjectSets(db, FIXTURE_PROJECT_ID)).toHaveLength(2)
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
      // No stored timings for this take, so slots keep the planner's seconds.
      words: [],
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
      styleAnchors: 'a',
      direction: null,
    })

    expect(result.rows).toHaveLength(1)
    expect(callLlm).toHaveBeenCalledTimes(2)
    const first = callLlm.mock.calls[0]?.[0]?.maxTokens ?? 0
    const second = callLlm.mock.calls[1]?.[0]?.maxTokens ?? 0
    expect(second).toBe(Math.min(MAX_OUTPUT_TOKENS, first * 2))
  })

  it("the shot-list request carries the project's sets", async () => {
    callLlm.mockResolvedValueOnce({ text: PLAN })

    await planChapterSlots({
      projectId: FIXTURE_PROJECT_ID,
      caseTitle: 'Wirecard',
      chapter: { id: 'ch-1', title: 'The audit', number: 1 },
      paragraphs: PARAGRAPHS,
      claims: [],
      styleAnchors: 'a',
      direction: null,
      sets: [{ name: 'Boardroom', look: 'dark wood panelling, one window' }],
    })

    const prefix = callLlm.mock.calls[0]?.[0]?.messages?.[0]?.content ?? ''
    expect(prefix).toContain('Boardroom: dark wood panelling, one window')
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
        styleAnchors: 'a',
        direction: null,
      }),
    ).rejects.toThrow(/cut off mid-answer/)
    expect(callLlm).toHaveBeenCalledTimes(2)
  })
})

describe('planChapterSlots plans a graphic and threads the logo library (decision 268, Plan B)', () => {
  const PARAGRAPHS: TimedParagraph[] = [
    {
      chapterId: 'ch-1',
      index: 0,
      text: 'The company raised four billion dollars in one round.',
      startMs: 0,
      durationMs: 9000,
      words: [],
    },
  ]
  const CLAIMS = [
    {
      id: 'claim-1',
      text: 'The company raised $4 billion.',
      sourceUrl: null,
      confidence: 'sourced',
    },
    { id: 'claim-2', text: 'x', sourceUrl: null, confidence: 'sourced' },
  ]

  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("resolves the mock graphic's logo to the library asset it names, citing the first claim", async () => {
    const result = await planChapterSlots({
      projectId: FIXTURE_PROJECT_ID,
      caseTitle: 'Wirecard',
      chapter: { id: 'ch-1', title: 'The audit', number: 1 },
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      styleAnchors: 'a',
      direction: null,
      logos: [{ id: 'logo-1', title: 'Wirecard AG' }],
    })

    const graphic = result.rows.find((row) => row.type === 'graphic')
    expect(graphic).toBeDefined()
    const brief = graphic?.brief as {
      type: string
      scene: { elements: { kind: string; entity?: string; assetId?: string; claimRef?: string }[] }
    }
    const figure = brief.scene.elements.find((element) => element.kind === 'figure')
    expect(figure).toMatchObject({ claimRef: 'claim-1' })
    const logo = brief.scene.elements.find((element) => element.kind === 'logo')
    expect(logo).toMatchObject({ entity: 'Wirecard AG', assetId: 'logo-1' })
  })

  it('stores the graphic with no logo element when the library holds no marks', async () => {
    const result = await planChapterSlots({
      projectId: FIXTURE_PROJECT_ID,
      caseTitle: 'Wirecard',
      chapter: { id: 'ch-1', title: 'The audit', number: 1 },
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      styleAnchors: 'a',
      direction: null,
      logos: [],
    })

    const graphic = result.rows.find((row) => row.type === 'graphic')
    expect(graphic).toBeDefined()
    const brief = graphic?.brief as { type: string; scene: { elements: { kind: string }[] } }
    expect(brief.scene.elements.some((element) => element.kind === 'logo')).toBe(false)
  })
})

describe('planChapterSlots repairs a chapter once, on auto findings only (decision 271)', () => {
  const SENTENCE = 'Mostaque told the investors the money was there.'
  const PARAGRAPHS: TimedParagraph[] = [
    { chapterId: 'ch-1', index: 0, text: SENTENCE, startMs: 0, durationMs: 9000, words: [] },
  ]
  const still = (extra: Record<string, unknown> = {}) => ({
    type: 'still',
    coversText: SENTENCE,
    description: 'A server rack in the dark.',
    shotSize: 'close',
    prompt: 'A server rack in the dark, 50mm lens.',
    motion: { kind: 'static' },
    transition: 'cut',
    ...extra,
  })
  const stock = {
    type: 'stock',
    coversText: SENTENCE,
    description: 'An office.',
    shotSize: 'wide',
    query: 'office',
    rejectionCriteria: [],
    motion: { kind: 'static' },
    transition: 'cut',
  }
  const plan = (brief: Record<string, unknown>) =>
    JSON.stringify({ slots: [{ paragraphIndex: 0, seconds: 9, brief }] })
  const planInput = {
    projectId: FIXTURE_PROJECT_ID,
    caseTitle: 'Stability AI',
    chapter: { id: 'ch-1', title: 'The exit', number: 1 },
    paragraphs: PARAGRAPHS,
    claims: [],
    styleAnchors: 'a',
    direction: null,
    photographed: ['Emad Mostaque'],
  }

  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('makes no repair call for a clean chapter', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(still({ depicts: ['Emad Mostaque'] })) })
    await planChapterSlots(planInput)
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('repairs a still that leaves out the photographed person its sentence names', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(still()) }).mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [
          still({
            prompt: 'Emad Mostaque at the boardroom table, 35mm lens.',
            depicts: ['Emad Mostaque'],
          }),
        ],
      }),
    })

    const result = await planChapterSlots(planInput)

    expect(callLlm).toHaveBeenCalledTimes(2)
    const ask = callLlm.mock.calls[1]?.[0]?.messages?.at(-1)?.content ?? ''
    expect(ask).toContain('Emad Mostaque is named here and photographed')
    expect(result.rows[0]?.brief).toMatchObject({ depicts: ['Emad Mostaque'] })
  })

  it('leaves a stock slot naming the person to the producer: no automatic call', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(stock) })
    await planChapterSlots(planInput)
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('keeps the original when the repair changes the slot type', async () => {
    callLlm
      .mockResolvedValueOnce({ text: plan(still()) })
      .mockResolvedValueOnce({ text: JSON.stringify({ briefs: [stock] }) })
    const result = await planChapterSlots(planInput)
    expect(result.rows[0]?.type).toBe('still')
    expect(result.rows[0]?.brief).not.toHaveProperty('depicts')
  })

  // The catch is unconditional by design: a budget refusal, a malformed answer
  // and a network error all keep the plan as planned.
  it('keeps the plan as planned when the repair call fails', async () => {
    callLlm
      .mockResolvedValueOnce({ text: plan(still()) })
      .mockRejectedValueOnce(new Error('over budget'))
    const result = await planChapterSlots(planInput)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.brief).toMatchObject({ prompt: 'A server rack in the dark, 50mm lens.' })
  })

  it('stores no banned word', async () => {
    callLlm.mockResolvedValueOnce({
      text: plan(
        still({ prompt: 'A cinematic boardroom, 35mm lens.', depicts: ['Emad Mostaque'] }),
      ),
    })
    const result = await planChapterSlots(planInput)
    expect(result.rows[0]?.brief).toMatchObject({ prompt: 'A boardroom, 35mm lens.' })
  })
})

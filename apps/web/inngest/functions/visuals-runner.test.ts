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
  listShotSlots,
  requireTestDatabase,
  saveChapter,
  seed,
  setCastPhotos,
  setProjectDirection,
  shotSlots,
  truncateRunMirror,
  updateProjectSet,
  updateSettings,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import { DirectorsBookSchema } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { visualsReviewModel } from '@/lib/visuals-review'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsRunner } from './visuals-runner'

/**
 * The visuals-runner against the real database, in mock-provider mode
 * (decision 252): the Director's Book is drafted before the first chapter is
 * planned, the plan is written against it, and the run parks on the plan.
 * The park would wait 30 days, so the test answers it with "no decision".
 */

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('visuals-runner (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsRunner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.\n\nThe trail led to Manila.',
      estRuntimeSec: 30,
    })
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // Settings are a global singleton, not scoped to this test's project:
    // the route-stamping tests below repoint `modelRouting` and must put it
    // back, or a later file inherits a routing no still model answers to.
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: null,
      },
    })
  })

  it('drafts the book, plans against it, and parks on the plan', async () => {
    // `step.waitForEvent` is non-runnable in the harness (see the demo-pipeline
    // test), so the run is driven up to the step that opens the plan park and
    // the database is read from there.
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project?.direction).toMatchObject({ motifs: expect.any(Array) })
    expect(project?.visualsPhase).toBe('plan')

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some((slot) => (slot.brief as { shotSize?: string }).shotSize)).toBe(true)
  })

  it('reuses an owner-edited book instead of redrafting it', async () => {
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    const drafted = DirectorsBookSchema.parse((await getProject(db, FIXTURE_PROJECT_ID))?.direction)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...drafted,
      visualThesis: 'edited by the owner',
    })

    const again = new InngestTestEngine({ function: visualsRunner })
    await again.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'edited by the owner',
    })
  })

  /**
   * Routing (decision 264): the runner stores NO route. `shot_slots.route`
   * holds the owner's explicit choice and nothing else, so the Settings
   * default keeps moving every planned slot; the rule is re-derived where it
   * is read, and the board shows it as the planned default. Live-model mode
   * here, not mock, because `mockShotList` never plans a "still" brief.
   *
   * `callLlm` answers by request task rather than by call order: the harness
   * cannot drive `step.waitForEvent`, so `executeStep` may replay the
   * function from the top more than once before it settles on the named
   * step, and a call-order queue would starve on the replay.
   */
  function stubDirectionAndShotList(book: unknown, plan: { slots: unknown[] }): void {
    callLlm.mockReset()
    callLlm.mockImplementation((request: { task: string }) => {
      if (request.task === 'direction') return Promise.resolve({ text: JSON.stringify(book) })
      return Promise.resolve({ text: JSON.stringify(plan) })
    })
  }

  /**
   * Guards the whole production chain (decision 275): a set's room inventory
   * is loaded in `load-narration` (`sets.map(({ name, look, layout }) =>
   * ...)`), carried through `planChapterSlots` into
   * `chapterShotListRequest`, and only shows up in the live model's prompt
   * if every hop in that chain keeps `layout` rather than quietly dropping
   * it back to `{ name, look }`. Live-model mode, like the routing tests
   * above, because mock mode never calls `buildShotListRequest` at all.
   */
  it("threads a set's room inventory into the live shot-list request (decision 275)", async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    // A leftover "Boardroom" from an earlier run of this suite (project sets
    // are not truncated in `beforeEach`, unlike the script and cast) would
    // otherwise fail the insert below with a duplicate-name error.
    for (const existing of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      if (existing.name === 'Boardroom') await deleteProjectSet(db, existing.id)
    }
    const set = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Boardroom',
      look: 'dark wood panelling, one window',
    })
    await updateProjectSet(db, set.id, { layout: 'North wall: three tall windows.' })

    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    stubDirectionAndShotList(book, {
      slots: [
        {
          paragraphIndex: 0,
          seconds: 6,
          brief: {
            type: 'stock',
            coversText: 'By June, the auditors could not find the money.',
            description: 'An empty audit office at dusk.',
            shotSize: 'wide',
            motion: { kind: 'static' },
            transition: 'cut',
            query: 'empty office dusk',
            rejectionCriteria: [],
          },
        },
      ],
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const shotListCall = callLlm.mock.calls.find(
      ([request]) => (request as { task?: string }).task === 'shotlist',
    )
    const prefix =
      (shotListCall?.[0] as { messages?: { content?: string }[] } | undefined)?.messages?.[0]
        ?.content ?? ''
    expect(prefix).toContain('- Boardroom: dark wood panelling, one window')
    expect(prefix).toContain('  North wall: three tall windows.')
  })

  it('derives the likeness route for a still of a photographed person, storing none', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: { provider: 'fal', model: 'fal-ai/flux/dev' },
      },
    })
    // A previous test's cast is not this test's business.
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
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

    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    stubDirectionAndShotList(book, {
      slots: [
        {
          paragraphIndex: 0,
          seconds: 6,
          brief: {
            type: 'still',
            coversText: 'By June, the auditors could not find the money.',
            description: 'Emad Mostaque at a desk, tense, dim light.',
            shotSize: 'medium',
            motion: { kind: 'static' },
            transition: 'cut',
            prompt: 'Emad Mostaque, the person in the reference photo, at a desk.',
            depicts: ['Emad Mostaque'],
          },
        },
      ],
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.some((slot) => slot.type === 'still')).toBe(true)
    // Nothing is stamped; the board derives it and offers it as the default.
    expect(slots.every((slot) => slot.route === null)).toBe(true)

    const board = await visualsReviewModel(db, FIXTURE_PROJECT_ID)
    const still = board.chapters.flatMap((chapter) => chapter.slots).find((s) => s.type === 'still')
    expect(still?.route).toBeNull()
    expect(still?.derivedRoute).toEqual({ provider: 'fal', model: 'fal-ai/flux/dev' })
  })

  it('leaves every planned slot without a route of its own', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: { provider: 'fal', model: 'fal-ai/flux/dev' },
      },
    })
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }

    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    stubDirectionAndShotList(book, {
      slots: [
        {
          paragraphIndex: 0,
          seconds: 6,
          brief: {
            type: 'still',
            coversText: 'By June, the auditors could not find the money.',
            description: 'An empty ledger on a desk, cool light.',
            shotSize: 'medium',
            motion: { kind: 'static' },
            transition: 'cut',
            prompt: 'An empty ledger on a desk, cool light.',
          },
        },
      ],
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.route === null)).toBe(true)
  })

  // The copy-reused-shots step (decision 261) has no engine test: the run
  // cannot be driven past step.waitForEvent in this harness, even with the
  // wait stubbed (the limit demo-pipeline.test.ts describes). The step is one
  // line over copyReusedShots, which the db integration suite proves; the
  // refetcher guard, which has no wait in front of it, is proved in
  // slot-refetcher.test.ts.
})

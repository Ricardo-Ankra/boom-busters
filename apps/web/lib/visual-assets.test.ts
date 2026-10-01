// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  deleteCastMember,
  deleteProjectSet,
  getSettings,
  insertCastMember,
  insertLogo,
  insertProjectSet,
  listCastMembers,
  listProjectSets,
  recordSocialPost,
  replaceCatalogue,
  requireTestDatabase,
  seed,
  setCastPhotos,
  socialPosts,
  setSetPlates,
  updateProjectSet,
  updateSettings,
  upsertAssetByHash,
} from '@boom-busters/db'
import { mockImageGen } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, newId, STILL_GENERATIONS } from '@boom-busters/schemas'
import type {
  CastMember,
  GraphicBrief,
  ModelRouting,
  ProjectSet,
  SocialBrief,
  StillBrief,
} from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listLedger } from '@boom-busters/cost'
import { db } from '@/lib/db'
import * as modelCatalogue from '@/lib/model-catalogue'
import { PHOTOGRAPH_LINE } from './photograph-lines'
import { assembleStillPrompt, REFERENCE_MARKER } from './still-prompt'
import {
  generateStillCandidates,
  plateEstimateUsd,
  referenceBudgets,
  resolveSlotBrief,
  routeForBrief,
  setSheetEstimateUsd,
  stillPromptFor,
  stillSlotEstimateUsd,
  stillsEstimateUsd,
} from './visual-assets'

/**
 * Legacy fixture text (decision 287): before the assembler owned the house
 * photograph line and the Brand Kit anchors, a still prompt carried both
 * itself. Neither `HOUSE_PHOTOGRAPH` nor `stillStyleAnchors` is exported by
 * the providers package any more (Task 8), so this test copies their old
 * output literally, to prove the assembler still strips a brief written the
 * old way.
 */
const LEGACY_HOUSE_PHOTOGRAPH =
  'An available-light documentary photograph, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line; people caught candid and mid-moment, never posing or acting for the camera.'
const LEGACY_STYLE_ANCHORS =
  'subtle film grain; muted documentary colour grade anchored on #0f1115 and #f5a524 against #0a0a0b; sombre, photographic realism'

/**
 * Still generation with the cast (decision 253), in mock-provider mode
 * against the test database: a depicted cast member with a photo rides along
 * as a reference and is named in the prompt; a stranger, or a member with no
 * photo, changes nothing.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

const still: StillBrief = {
  type: 'still',
  coversText: 'March 2024. Emad Mostaque steps down.',
  description: 'A founder at a desk after the announcement.',
  shotSize: 'medium',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Emad Mostaque, founder and former CEO of Stability AI, seated at a desk at dusk.',
  depicts: ['Emad Mostaque'],
}

function photo(hash: string, view: 'front' | 'profile' | 'three-quarter' | 'full') {
  return {
    r2Key: `boom-busters/cast/${FIXTURE_PROJECT_ID}/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg' as const,
    width: 1000,
    height: 1200,
    view,
  }
}

function plate(hash: string, view: 'north' | 'east' | 'south' | 'west' | 'detail' | 'other') {
  return {
    r2Key: `boom-busters/sets/${FIXTURE_PROJECT_ID}/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg' as const,
    width: 1600,
    height: 900,
    view,
    origin: 'uploaded' as const,
  }
}

/**
 * Which model a generation actually went to. The request itself carries no
 * model id in mock mode (the mock adapter ignores it), but the cost ledger
 * records the route for every call, which is the thing worth asserting.
 */
async function lastLedgerModel(): Promise<unknown> {
  const [entry] = await listLedger(db, { projectId: FIXTURE_PROJECT_ID, limit: 1 })
  return entry?.meta['model']
}

describeDb('generateStillCandidates with the cast', () => {
  const generate = vi.spyOn(mockImageGen, 'generate')

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    generate.mockClear()
    await seed(db)
    // Every generation here passes the budget guard, and `seed` only creates
    // the settings row when it is absent — so a ceiling of $0, left in the
    // shared test database by one of the runner suites that asserts the
    // budget gate, would fail this file on whatever ran first. Own the
    // setting rather than inherit it.
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 100 } })
    for (const member of await listCastMembers(db, FIXTURE_PROJECT_ID)) {
      await deleteCastMember(db, member.id)
    }
    for (const set of await listProjectSets(db, FIXTURE_PROJECT_ID)) {
      await deleteProjectSet(db, set.id)
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('attaches the depicted member’s photo and names them as the person in the photo', async () => {
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

    const candidates = await generateStillCandidates(still, FIXTURE_PROJECT_ID)

    const request = generate.mock.calls[0]?.[0]
    expect(request?.references).toEqual([
      {
        name: 'Emad Mostaque',
        kind: 'character',
        mimeType: 'image/jpeg',
        data: expect.any(String),
      },
    ])
    expect(request?.prompt).toContain(
      'References attached: 1 photograph of Emad Mostaque. The photographs of Emad ' +
        'Mostaque are for likeness only: match the face exactly, with its hair, facial ' +
        'hair and glasses, while clothing, pose and expression follow the text above. ' +
        'Everyone else in the frame is a different person, unlike Emad Mostaque in face, ' +
        'hair and age. Emad Mostaque is photographed in the ' +
        'scene, never pasted onto it: at true scale, seated in a chair or standing on ' +
        "the floor, lit by the scene's own light, and behind anything standing nearer " +
        'the camera.',
    )
    // With no set there is no room to recompose.
    expect(request?.prompt).not.toContain('camera position')
    expect(candidates[0]?.references).toEqual(['Emad Mostaque'])
  })

  /**
   * The board's "Prompt sent to the model" disclosure (decision 287): built
   * from the same pure helpers generation uses, over the same cast and set
   * lists, so the preview and the call cannot disagree while storage works
   * (mock mode here always "loads" every photograph the plan asks for).
   */
  it('previews exactly the prompt generation sends (decision 287)', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [photo('front-1', 'front')])

    const cast = await listCastMembers(db, FIXTURE_PROJECT_ID)
    const sets = await listProjectSets(db, FIXTURE_PROJECT_ID)
    const settings = await getSettings(db)
    const catalogue = await modelCatalogue.stillCatalogue(settings)
    const preview = stillPromptFor(still, cast, sets, settings.modelRouting, null, catalogue)

    await generateStillCandidates(still, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.prompt).toBe(preview)
  })

  it('sends every angle of one person, front view first, up to the limit', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [
      photo('profile-1', 'profile'),
      photo('front-1', 'front'),
      photo('three-quarter-1', 'three-quarter'),
      photo('full-1', 'full'),
    ])

    const candidates = await generateStillCandidates(still, FIXTURE_PROJECT_ID)

    // Three slots, all spent on this one person, the front view leading.
    const request = generate.mock.calls[0]?.[0]
    expect(request?.references).toHaveLength(3)
    expect(request?.references?.every((reference) => reference.name === 'Emad Mostaque')).toBe(true)
    // The board still names the person once, not once per photograph.
    expect(candidates[0]?.references).toEqual(['Emad Mostaque'])
  })

  it('gives every person in the frame a photo before spending a slot on an angle', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    const prem = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Prem Akkaraju',
      role: 'CEO',
    })
    await setCastPhotos(db, emad.id, [photo('e-front', 'front'), photo('e-profile', 'profile')])
    await setCastPhotos(db, prem.id, [photo('p-front', 'front')])

    await generateStillCandidates(
      { ...still, depicts: ['Emad Mostaque', 'Prem Akkaraju'] },
      FIXTURE_PROJECT_ID,
    )

    // One each first, so neither face is missing, then the spare slot goes
    // to a second angle rather than being wasted.
    const names = generate.mock.calls[0]?.[0]?.references?.map((reference) => reference.name)
    expect(names).toEqual(['Emad Mostaque', 'Prem Akkaraju', 'Emad Mostaque'])
  })

  it('names only the people whose photographs the routed model actually takes', async () => {
    // No shipped model has a character limit under the app's own cap of
    // three, so this is a guard on the rule rather than on a live model: a
    // face the model is not shown must not be named as one it was. The
    // limits are read off the catalogue built per call (decision 287), so
    // the tight adapter goes into that catalogue.
    const real = modelCatalogue.stillCatalogue
    const tight = vi
      .spyOn(modelCatalogue, 'stillCatalogue')
      .mockImplementation(async (settings) => {
        const catalogue = await real(settings)
        vi.spyOn(catalogue.google, 'referenceLimits').mockReturnValue({
          characters: 1,
          objects: 0,
        })
        return catalogue
      })
    try {
      // Own the route: settings persist in the shared test database, and the
      // spy is on the adapter this route resolves to.
      await updateSettings(db, {
        modelRouting: {
          stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
          stillsLikeness: null,
        },
      })
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      const prem = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Prem Akkaraju',
        role: 'CEO',
      })
      await setCastPhotos(db, emad.id, [photo('e-front', 'front')])
      await setCastPhotos(db, prem.id, [photo('p-front', 'front')])

      const candidates = await generateStillCandidates(
        { ...still, depicts: ['Emad Mostaque', 'Prem Akkaraju'] },
        FIXTURE_PROJECT_ID,
      )

      const request = generate.mock.calls[0]?.[0]
      expect(request?.references?.map((reference) => reference.name)).toEqual(['Emad Mostaque'])
      expect(request?.prompt).toContain('References attached: 1 photograph of Emad Mostaque.')
      expect(request?.prompt).not.toContain('Prem Akkaraju')
      expect(candidates[0]?.references).toEqual(['Emad Mostaque'])
    } finally {
      tight.mockRestore()
    }
  })

  /**
   * Two routes, chosen by whether the still can show a real face (decision
   * 253, amended). Mock mode serves the mock adapter whichever id is asked
   * for, so the assertion is on the model the request carried.
   */
  describe('routing a still by whether it shows the cast', () => {
    beforeEach(async () => {
      await updateSettings(db, {
        modelRouting: {
          stills: { provider: 'google', model: 'gemini-2.5-flash-image' },
          stillsLikeness: { provider: 'google', model: 'gemini-3-pro-image' },
        },
      })
    })

    afterEach(async () => {
      await updateSettings(db, { modelRouting: { stillsLikeness: null } })
    })

    it('sends a still of a photographed cast member to the likeness route', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])

      await generateStillCandidates(still, FIXTURE_PROJECT_ID)
      expect(await lastLedgerModel()).toBe('gemini-3-pro-image')
    })

    it('sends a still whose depicts names the member with their role to the likeness route', async () => {
      // What the planner wrote on 2026-09-19: the prompt's "full name and
      // role" carried into the list, and an exact-name join sent every such
      // still to the plain route without its photographs.
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])

      await generateStillCandidates(
        { ...still, depicts: ['Emad Mostaque, founder and former CEO of Stability AI'] },
        FIXTURE_PROJECT_ID,
      )
      expect(await lastLedgerModel()).toBe('gemini-3-pro-image')
      expect(generate.mock.calls[0]?.[0].references).toHaveLength(1)
    })

    it('leaves a still of nobody on the ordinary route', async () => {
      const plain = { ...still, depicts: [] }
      await generateStillCandidates(plain, FIXTURE_PROJECT_ID)
      expect(await lastLedgerModel()).toBe('gemini-2.5-flash-image')
    })

    it('treats a name the cast cannot photograph as a plain still', async () => {
      // In the cast, but no photograph: there is no likeness to be had, so
      // paying the likeness route for it would buy nothing.
      await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await generateStillCandidates(still, FIXTURE_PROJECT_ID)
      expect(await lastLedgerModel()).toBe('gemini-2.5-flash-image')
    })
  })

  /**
   * The number on "Fetch visuals · est. $X" is the reason the split exists:
   * quoting the dearer route for every still made it useless. Each brief is
   * priced on the route it will actually take.
   */
  describe('estimating a planned set of stills', () => {
    const plain: StillBrief = { ...still, depicts: [] }

    beforeEach(async () => {
      await updateSettings(db, {
        modelRouting: {
          stills: { provider: 'google', model: 'gemini-2.5-flash-image' },
          stillsLikeness: { provider: 'google', model: 'gemini-3-pro-image' },
        },
      })
    })

    afterEach(async () => {
      await updateSettings(db, { modelRouting: { stillsLikeness: null } })
    })

    it('prices each brief on its own route, not all of them on the dearest', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])

      // gemini-2.5-flash-image $0.04, gemini-3-pro-image $0.15, two
      // generations per slot: one likeness still and three plain ones.
      const briefs = [still, plain, plain, plain]
      const expected = (0.15 + 0.04 * 3) * STILL_GENERATIONS
      expect(await stillsEstimateUsd(briefs, FIXTURE_PROJECT_ID)).toBeCloseTo(expected)

      // Cheaper than quoting every still at the likeness route, which is
      // exactly the over-statement this replaced.
      expect(await stillsEstimateUsd(briefs, FIXTURE_PROJECT_ID)).toBeLessThan(
        0.15 * 4 * STILL_GENERATIONS,
      )
    })

    it('prices a depicted person with no photograph as a plain still', async () => {
      await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      expect(await stillsEstimateUsd([still], FIXTURE_PROJECT_ID)).toBeCloseTo(
        0.04 * STILL_GENERATIONS,
      )
    })

    it('prices a still whose depicts carries the name and a role at the likeness route', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])
      const withRole = {
        ...still,
        depicts: ['Emad Mostaque, founder and former CEO of Stability AI'],
      }
      expect(await stillsEstimateUsd([withRole], FIXTURE_PROJECT_ID)).toBeCloseTo(
        0.15 * STILL_GENERATIONS,
      )
    })

    it('ignores briefs that are not stills, which cost nothing to fetch', async () => {
      const stock = { ...still, type: 'stock' as const }
      expect(await stillsEstimateUsd([stock as unknown as typeof still], FIXTURE_PROJECT_ID)).toBe(
        0,
      )
      expect(await stillsEstimateUsd([], FIXTURE_PROJECT_ID)).toBe(0)
    })

    it('quotes what the run then spends, for the same brief', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])

      const quoted = await stillsEstimateUsd([still], FIXTURE_PROJECT_ID)
      await generateStillCandidates(still, FIXTURE_PROJECT_ID)
      const [entry] = await listLedger(db, { projectId: FIXTURE_PROJECT_ID, limit: 1 })
      expect(entry?.estimatedUsd).toBeCloseTo(quoted)
    })
  })

  it('generates everything on one route when no split is configured', async () => {
    // Stated explicitly rather than left to the settings default, so this
    // test still means "no split" once the default model changes underneath
    // it (decision 264).
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-2.5-flash-image' },
        stillsLikeness: null,
      },
    })
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [photo('front-1', 'front')])
    await generateStillCandidates(still, FIXTURE_PROJECT_ID)
    expect(await lastLedgerModel()).toBe('gemini-2.5-flash-image')
  })

  it('does not repeat the clause when the planner already wrote it', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [
      {
        r2Key: 'boom-busters/cast/p/bbb.jpg',
        contentHash: 'bbb',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        view: 'other',
      },
    ])
    // Already decorated: the declaration is written once, never stacked.
    const prompt = `Emad Mostaque at a podium.

References attached: 1 photograph of Emad Mostaque.`
    await generateStillCandidates({ ...still, prompt }, FIXTURE_PROJECT_ID)
    const sent = generate.mock.calls[0]?.[0]?.prompt ?? ''
    expect(sent.match(/References attached:/g)).toHaveLength(1)
    expect(sent).toContain('Emad Mostaque at a podium.')
  })

  it('generates from text alone for a stranger or a member without photos', async () => {
    await insertCastMember(db, { projectId: FIXTURE_PROJECT_ID, name: 'Emad Mostaque', role: 'x' })
    const candidates = await generateStillCandidates(still, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.references).toBeUndefined()
    expect(generate.mock.calls[0]?.[0]?.prompt).toBe(
      assembleStillPrompt({
        scene: still.prompt,
        layout: '',
        people: [],
        set: null,
        ...(still.shotSize ? { shotSize: still.shotSize } : {}),
      }),
    )
    expect(candidates[0]?.references).toBeUndefined()

    generate.mockClear()
    await generateStillCandidates({ ...still, depicts: ['Nobody Known'] }, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.references).toBeUndefined()
  })

  // A brief stored before decision 271, or edited in by hand, still carries a
  // banned word; it is removed at the last point before the image model.
  it('strips a banned word from a stored prompt before generating', async () => {
    await generateStillCandidates(
      { ...still, prompt: 'A cinematic boardroom at dusk.' },
      FIXTURE_PROJECT_ID,
    )
    const sent = generate.mock.calls[0]?.[0]?.prompt ?? ''
    expect(sent).toContain('A boardroom at dusk.')
    expect(sent).not.toContain('cinematic')
  })

  it('a graphic resolves at no cost when every logo has a mark, and waits as a placeholder otherwise', async () => {
    const mark = await insertLogo(db, {
      r2Key: `boom-busters/logos/${FIXTURE_PROJECT_ID}.png`,
      contentHash: `logo-${FIXTURE_PROJECT_ID}`,
      title: 'Stability AI',
      width: 400,
      height: 200,
    })
    const brief = (assetId?: string): GraphicBrief => ({
      type: 'graphic',
      coversText: 'x',
      description: 'y',
      motion: { kind: 'static' },
      transition: 'cut',
      shotSize: 'graphic',
      scene: {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 },
            entity: 'Stability AI',
            enter: { kind: 'fade', atMs: 0 },
            ...(assetId ? { assetId } : {}),
          },
        ],
      },
    })
    expect(
      await resolveSlotBrief({
        projectId: FIXTURE_PROJECT_ID,
        brief: brief(mark!.id),
        route: null,
      }),
    ).toEqual({ candidates: [], status: 'resolved' })
    expect(
      await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief: brief(), route: null }),
    ).toEqual({ candidates: [], status: 'placeholder' })
    expect(generate).not.toHaveBeenCalled()
  })

  it('a graphic whose matched mark was since deleted returns to placeholder, not resolved', async () => {
    // A stored assetId is not proof the mark is still in the library: it can
    // have been removed after this brief was written. Resolution must catch
    // this the same way it catches a mark that was never matched, rather
    // than trusting a stale id and reporting the slot ready when the render
    // will have nothing to draw for it.
    const brief: GraphicBrief = {
      type: 'graphic',
      coversText: 'x',
      description: 'y',
      motion: { kind: 'static' },
      transition: 'cut',
      shotSize: 'graphic',
      scene: {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 },
            entity: 'Stability AI',
            enter: { kind: 'fade', atMs: 0 },
            assetId: '01HQ00000000000000000000M9',
          },
        ],
      },
    }
    expect(await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief, route: null })).toEqual({
      candidates: [],
      status: 'placeholder',
    })
  })

  describe('a social slot resolves by reading its stored post', () => {
    // A blank read never wipes a stored field (decision 284), so each case
    // starts from no row rather than writing over whatever the last one left.
    beforeEach(async () => {
      await db.delete(socialPosts)
    })

    const socialBrief = (overrides: Partial<SocialBrief> = {}): SocialBrief => ({
      type: 'social',
      coversText: 'x',
      description: 'y',
      motion: { kind: 'static' },
      transition: 'cut',
      sourceClaimId: newId(),
      postUrl: 'https://x.com/i/status/1234567890123456789',
      ...overrides,
    })

    it('is a placeholder for a post the reader could not read', async () => {
      await recordSocialPost(db, {
        url: 'https://x.com/i/status/1234567890123456789',
        platform: 'x',
        postId: '1234567890123456789',
        handle: 'emad_mostaque',
        authorName: null,
        text: null,
        postedAt: null,
        endedWithMediaLink: false,
        provenance: {},
        status: 'failed',
        failureReason: 'X says this post does not exist or is not public.',
      })
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief(),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'placeholder' })
    })

    it('is a placeholder for a post too long to show in full with no excerpt chosen', async () => {
      await recordSocialPost(db, {
        url: 'https://x.com/i/status/1234567890123456789',
        platform: 'x',
        postId: '1234567890123456789',
        handle: 'emad_mostaque',
        authorName: 'Emad Mostaque',
        text: 'A long thread about the future of open models. '.repeat(200),
        postedAt: '2024-01-01',
        endedWithMediaLink: false,
        provenance: {},
        status: 'fetched',
        failureReason: null,
      })
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief(),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'placeholder' })
    })

    it('is a placeholder for an excerpt that is not copied word for word from the post', async () => {
      await recordSocialPost(db, {
        url: 'https://x.com/i/status/1234567890123456789',
        platform: 'x',
        postId: '1234567890123456789',
        handle: 'emad_mostaque',
        authorName: 'Emad Mostaque',
        text: 'Stepping down as CEO of Stability AI.',
        postedAt: '2024-01-01',
        endedWithMediaLink: false,
        provenance: {},
        status: 'fetched',
        failureReason: null,
      })
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief({ excerpt: 'I am not stepping down' }),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'placeholder' })
    })

    // Nine lines of about 46 characters fit the landscape card and not the
    // Shorts card, which draws the same slot at 1080x1920 (decision 284).
    const LINE_46 = 'Our auditors could not find the missing money.'
    const lines = (count: number) => Array.from({ length: count }, () => LINE_46).join('\n')
    const recordText = (text: string) =>
      recordSocialPost(db, {
        url: 'https://x.com/i/status/1234567890123456789',
        platform: 'x',
        postId: '1234567890123456789',
        handle: 'emad_mostaque',
        authorName: 'Emad Mostaque',
        text,
        postedAt: '2024-01-01',
        endedWithMediaLink: false,
        provenance: {},
        status: 'fetched',
        failureReason: null,
      })

    it('is a placeholder for a post that fits 16:9 but not 9:16', async () => {
      await recordText(lines(9))
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief(),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'placeholder' })
    })

    it('judges the room for an attached image only when that image still exists', async () => {
      // Three lines fit either card on their own, but not the Shorts card
      // with an image under them.
      await recordText(lines(3))
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief({ mediaAssetId: newId() }),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'resolved' })

      const image = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: 'boom-busters/uploads/social-image.png',
        licence: 'Uploaded by owner',
        contentHash: 'e'.repeat(64),
      })
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief({ mediaAssetId: image.id }),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'placeholder' })
    })

    it('is resolved for a complete short post', async () => {
      await recordSocialPost(db, {
        url: 'https://x.com/i/status/1234567890123456789',
        platform: 'x',
        postId: '1234567890123456789',
        handle: 'emad_mostaque',
        authorName: 'Emad Mostaque',
        text: 'Stepping down as CEO of Stability AI.',
        postedAt: '2024-01-01',
        endedWithMediaLink: false,
        provenance: {},
        status: 'fetched',
        failureReason: null,
      })
      expect(
        await resolveSlotBrief({
          projectId: FIXTURE_PROJECT_ID,
          brief: socialBrief(),
          route: null,
        }),
      ).toEqual({ candidates: [], status: 'resolved' })
    })
  })

  describe('a still that names a set', () => {
    beforeEach(async () => {
      await updateSettings(db, {
        modelRouting: {
          stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
          stillsLikeness: null,
        },
      })
    })

    it('sends the set plate as an object reference beside the person', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'north')])

      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )

      const sent = generate.mock.calls[0]?.[0].references ?? []
      expect(sent.filter((r) => r.kind === 'character')).toHaveLength(1)
      expect(sent.filter((r) => r.kind === 'object')).toHaveLength(1)
    })

    it('counts people and room in one declaration, and says the photographs win', async () => {
      const member = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'x',
      })
      await setCastPhotos(db, member.id, [photo('a', 'front'), photo('b', 'profile')])
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'north')])

      await generateStillCandidates(
        { ...still, depicts: ['Emad Mostaque'], set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )

      const prompt = generate.mock.calls[0]?.[0].prompt ?? ''
      expect(prompt).toContain(
        'References attached: 2 photographs of Emad Mostaque and 1 photograph of ' +
          'Venture Capital Boardroom. The photographs of Emad Mostaque are for likeness only',
      )
      expect(prompt).toContain('Emad Mostaque is photographed in the scene, never pasted onto it')
      expect(prompt).toContain(
        "The photographs of Venture Capital Boardroom show this room's furniture, materials and light",
      )
      // Decision 273: the old wording made the model edit the plate.
      expect(prompt).not.toContain('match them exactly')
      expect(prompt).not.toContain('describes only what happens in them')
      // Decision 287: positive either way, never an edit instruction.
      expect(prompt).not.toContain('never reproduce or edit the framing')
      // The brief's own words stay before the declaration; the photograph
      // line closes the prompt now, not the declaration.
      expect(prompt.indexOf(still.prompt)).toBeGreaterThanOrEqual(0)
      expect(prompt.indexOf(still.prompt)).toBeLessThan(prompt.indexOf(REFERENCE_MARKER))
    })

    it('names the room in the prompt, so the model knows which image is which', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'north')])

      await generateStillCandidates(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )
      const prompt = generate.mock.calls[0]?.[0].prompt ?? ''
      expect(prompt).toContain(
        'References attached: 1 photograph of Venture Capital Boardroom. The photographs ' +
          "of Venture Capital Boardroom show this room's furniture, materials and light; " +
          'this photograph is a new one taken inside it.',
      )
      expect(prompt).not.toContain('never reproduce or edit the framing')
      // No person, so no staging sentence.
      expect(prompt).not.toContain('pasted onto it')
    })

    it('spends people before plates when the budget is tight', async () => {
      for (const name of ['Emad Mostaque', 'Prem Akkaraju', 'Sean Parker']) {
        const member = await insertCastMember(db, {
          projectId: FIXTURE_PROJECT_ID,
          name,
          role: 'Principal',
        })
        await setCastPhotos(db, member.id, [photo(`front-${name}`, 'front')])
      }
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'north')])

      await generateStillCandidates(
        {
          ...still,
          depicts: ['Emad Mostaque', 'Prem Akkaraju', 'Sean Parker'],
          set: 'Venture Capital Boardroom',
        },
        FIXTURE_PROJECT_ID,
      )
      const sent = generate.mock.calls[0]?.[0].references ?? []
      expect(sent.filter((r) => r.kind === 'character')).toHaveLength(3)
      expect(sent.filter((r) => r.kind === 'object')).toHaveLength(1)
    })

    it('treats a set the project does not hold as no set at all', async () => {
      await generateStillCandidates(
        { ...still, depicts: [], set: 'A car park' },
        FIXTURE_PROJECT_ID,
      )
      expect(generate.mock.calls[0]?.[0].references ?? []).toHaveLength(0)
    })

    it('sends no plate for a set that holds none', async () => {
      await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await generateStillCandidates(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )
      expect(generate.mock.calls[0]?.[0].references ?? []).toHaveLength(0)
    })

    /**
     * The regression decision 270 exists for. Every other test in this block
     * runs on gemini-3.1-flash-image, which Google documents as taking ten
     * objects, so none of them could see that gemini-2.5-flash-image declared
     * zero and silently dropped the plate. A project routed at 2.5 got no
     * plate AND a prompt that never named the room, and nothing failed.
     */
    it('carries the plate on gemini-2.5-flash-image too, which once dropped it', async () => {
      await updateSettings(db, {
        modelRouting: {
          stills: { provider: 'google', model: 'gemini-2.5-flash-image' },
          stillsLikeness: null,
        },
      })
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'north')])

      await generateStillCandidates(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )

      // Mock mode omits the model from the request, so the ledger names it. The
      // plate count below is still the real 2.5 budget: limits come from the
      // LIVE adapter in every mode.
      expect(await lastLedgerModel()).toBe('gemini-2.5-flash-image')
      const request = generate.mock.calls[0]?.[0]
      expect((request?.references ?? []).filter((r) => r.kind === 'object')).toHaveLength(1)
      // And the room reaches the model in words as well as pixels.
      expect(request?.prompt).toContain(
        'References attached: 1 photograph of Venture Capital Boardroom.',
      )
    })
  })

  describe('the camera (decision 275)', () => {
    it('sends the plates nearest the camera, each labelled by direction', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long table.',
      })
      await setSetPlates(db, room.id, [
        plate('p-n', 'north'),
        plate('p-e', 'east'),
        plate('p-s', 'south'),
      ])
      await generateStillCandidates(
        {
          ...still,
          set: 'Venture Capital Boardroom',
          camera: { facing: 'south', position: 'the north windows' },
        },
        FIXTURE_PROJECT_ID,
      )
      const request = generate.mock.calls[0]?.[0]
      expect(request?.references?.map((reference) => reference.facing)).toEqual(['south', 'east'])
      expect(request?.size).toBe('1K')
    })

    it('closes the prompt with the camera and what it sees', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long table.',
      })
      await updateProjectSet(db, room.id, { layout: 'North wall: windows\nSouth wall: glass' })
      await setSetPlates(db, room.id, [plate('p-n', 'north')])
      await generateStillCandidates(
        {
          ...still,
          set: 'Venture Capital Boardroom',
          shotSize: 'wide',
          camera: { facing: 'north', position: 'the south doorway' },
        },
        FIXTURE_PROJECT_ID,
      )
      const prompt = generate.mock.calls[0]?.[0].prompt ?? ''
      expect(prompt).toContain(
        'The camera stands at the south doorway, facing north. In frame: windows.',
      )
      expect(prompt).not.toContain('Behind the camera')
      expect(prompt).toContain(
        "The photographs of Venture Capital Boardroom show this room's furniture, materials and light; this photograph is a new one from the camera described above.",
      )
      expect(prompt).not.toContain('never reproduce or edit the framing')
    })

    // Review Focus 3: no plate yet, but the camera and inventory still count.
    it('sends the camera and inventory for a set with no plate', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long table.',
      })
      await updateProjectSet(db, room.id, { layout: 'East wall: credenza' })
      await generateStillCandidates(
        {
          ...still,
          set: 'Venture Capital Boardroom',
          shotSize: 'wide',
          camera: { facing: 'east', position: 'the window' },
        },
        FIXTURE_PROJECT_ID,
      )
      const request = generate.mock.calls[0]?.[0]
      expect(request?.references ?? []).toEqual([])
      expect(request?.prompt).toContain(
        'The camera stands at the window, facing east. In frame: credenza.',
      )
    })

    // Decision 287: the decision 273 ending read as an edit instruction, so
    // the room sentence is the same whether or not a camera reaches it.
    it('says a new photograph without the edit wording for a set shot with no camera', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long table.',
      })
      await setSetPlates(db, room.id, [plate('p-n', 'north')])
      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )
      const prompt = generate.mock.calls[0]?.[0].prompt ?? ''
      expect(prompt).toContain(
        "The photographs of Venture Capital Boardroom show this room's furniture, materials " +
          'and light; this photograph is a new one taken inside it.',
      )
      expect(prompt).not.toContain('never reproduce or edit the framing')
    })

    // Final review (decision 275): the house line once carried "35mm, eye
    // level", so a camera with its own lens sent two. The whole prompt, as the
    // model reads it, now names one lens (the camera's) and one camera.
    it('sends one lens and one camera sentence for a person in a plated set', async () => {
      const emad = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Emad Mostaque',
        role: 'Founder',
      })
      await setCastPhotos(db, emad.id, [photo('front-1', 'front')])
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long table.',
      })
      await updateProjectSet(db, room.id, {
        layout: 'North wall: three tall windows\nSouth wall: glass onto the corridor',
      })
      await setSetPlates(db, room.id, [plate('p-n', 'north'), plate('p-s', 'south')])
      const anchors = LEGACY_STYLE_ANCHORS

      await generateStillCandidates(
        {
          ...still,
          set: 'Venture Capital Boardroom',
          prompt:
            'Emad Mostaque, founder of Stability AI, the person in the reference photo, seated ' +
            `at the far end of the table in Venture Capital Boardroom, grey dusk at the glass. ${LEGACY_HOUSE_PHOTOGRAPH} ${anchors}`,
          camera: { facing: 'north', position: 'the south doorway, seated height', lens: '85mm' },
        },
        FIXTURE_PROJECT_ID,
      )

      const request = generate.mock.calls[0]?.[0]
      const prompt = request?.prompt ?? ''
      expect(request?.references?.map((reference) => reference.kind)).toContain('character')
      expect(request?.references?.map((reference) => reference.kind)).toContain('object')
      expect(prompt.match(/\d+\s?mm/g)).toEqual(['85mm'])
      expect(prompt.match(/The camera stands at/g)).toHaveLength(1)
      // Decision 287: the legacy paste is stripped, not doubled; the
      // assembler's own line closes the prompt instead.
      expect(prompt).not.toContain(LEGACY_HOUSE_PHOTOGRAPH)
      expect(prompt).not.toContain(anchors)
      expect(prompt.endsWith(PHOTOGRAPH_LINE)).toBe(true)
      expect(prompt).not.toMatch(/film grain|#[0-9a-f]{6}/)
      expect(prompt).toContain(
        'The camera stands at the south doorway, seated height, facing north, 85mm.',
      )
    })
  })
})

describe('routeForBrief', () => {
  const routing = {
    stills: { provider: 'fal' as const, model: 'fal-ai/flux-2' },
    stillsLikeness: { provider: 'google' as const, model: 'gemini-3-pro-image' },
  } as ModelRouting

  const cast = [{ name: 'Emad Mostaque', photos: [{}] }] as unknown as CastMember[]
  const sets = [{ name: 'Venture Capital Boardroom', plates: [{}] }] as unknown as ProjectSet[]

  it('sends a still of a photographed person to the likeness route', () => {
    expect(routeForBrief({ ...still, depicts: ['Emad Mostaque'] }, cast, sets, routing)).toEqual(
      routing.stillsLikeness,
    )
  })

  it('sends a still in a photographed set to the likeness route too', () => {
    expect(
      routeForBrief(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        cast,
        sets,
        routing,
      ),
    ).toEqual(routing.stillsLikeness)
  })

  it('leaves a still of nobody, nowhere, on the ordinary route', () => {
    expect(routeForBrief({ ...still, depicts: [] }, cast, sets, routing)).toEqual(routing.stills)
  })

  it('falls back to the ordinary route when no split is configured', () => {
    const noSplit = { ...routing, stillsLikeness: null } as ModelRouting
    expect(routeForBrief({ ...still, depicts: ['Emad Mostaque'] }, cast, sets, noSplit)).toEqual(
      noSplit.stills,
    )
  })
})

describe('referenceBudgets', () => {
  it('spends the app policy under a generous model and the model under a tight one', () => {
    expect(referenceBudgets({ characters: 5, objects: 6 })).toEqual({ characters: 3, objects: 2 })
    expect(referenceBudgets({ characters: 1, objects: 0 })).toEqual({ characters: 1, objects: 0 })
  })
})

describeDb('the route stored on a slot wins', () => {
  it('generates on the stored route, not the derived one', async () => {
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/flux-2' }, stillsLikeness: null },
    })
    await generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID, {
      provider: 'google',
      model: 'gemini-3-pro-image',
    })
    expect(await lastLedgerModel()).toBe('gemini-3-pro-image')
  })

  it('carries the stored route through resolveSlotBrief, which every fetch goes through', async () => {
    // The five production fetch paths all call `resolveSlotBrief`, never the
    // generator directly, so a route that stops at this boundary makes the
    // board's model select decorative (decision 264).
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/flux-2' }, stillsLikeness: null },
    })
    const resolution = await resolveSlotBrief({
      projectId: FIXTURE_PROJECT_ID,
      brief: { ...still, depicts: [] },
      route: { provider: 'google', model: 'gemini-3-pro-image' },
    })
    expect(resolution.status).toBe('resolved')
    expect(await lastLedgerModel()).toBe('gemini-3-pro-image')
  })

  it('names the plain stills setting for a stored route equal to it by value', async () => {
    // The stored route is a different object with the same provider and
    // model; comparing identity named the likeness setting in the
    // missing-key message for a still that was never on it.
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: null,
      },
    })
    vi.stubEnv('MOCK_PROVIDERS', '')
    try {
      await expect(
        generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID, {
          provider: 'google',
          model: 'gemini-3.1-flash-image',
        }),
      ).rejects.toThrow(/^Stills are routed to google/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('prices a slot on its stored route', async () => {
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/flux-2' }, stillsLikeness: null },
    })
    const stored = { provider: 'google' as const, model: 'gemini-3-pro-image' }
    expect(
      await stillsEstimateUsd([{ ...still, depicts: [] }], FIXTURE_PROJECT_ID, [stored]),
    ).toBeCloseTo(0.15 * STILL_GENERATIONS)
  })

  it('prices a still routed at a live fal model from the cache (decision 287)', async () => {
    await replaceCatalogue(
      db,
      'fal',
      [
        {
          modelId: 'fal-ai/mock-flux',
          kind: 'image',
          label: 'Mock FLUX',
          preview: false,
          contextTokens: null,
          maxOutputTokens: null,
          dialect: 'flux',
          pricePerImage: 0.02,
        },
      ],
      new Date(),
    )
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'fal', model: 'fal-ai/mock-flux' },
        stillsLikeness: null,
      },
    })
    expect(await stillSlotEstimateUsd()).toBeCloseTo(0.02 * STILL_GENERATIONS)
    await generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID)
    expect(await lastLedgerModel()).toBe('fal-ai/mock-flux')
  })
})

describeDb('a live-only route the cache no longer holds (decision 287)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 100 } })
    // A refresh that stopped returning every live-only Google model.
    await replaceCatalogue(db, 'google', [], new Date())
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await updateSettings(db, { modelRouting: DEFAULT_SETTINGS.modelRouting })
  })

  it('still prices a Gemini model its family resolves from settings alone', async () => {
    const route = { provider: 'google' as const, model: 'gemini-9-flash-image' }
    await updateSettings(db, {
      modelRouting: { stills: route, stillsLikeness: route, setSheet: route },
    })
    // Gemini 3.1 Flash Image's price: $0.07 per image, $0.16 at 4K.
    expect(await stillSlotEstimateUsd()).toBeCloseTo(0.07 * STILL_GENERATIONS)
    expect(await plateEstimateUsd()).toBeCloseTo(0.07 * STILL_GENERATIONS)
    expect(await setSheetEstimateUsd()).toBeCloseTo(0.16)
    expect(await stillsEstimateUsd([{ ...still, depicts: [] }], FIXTURE_PROJECT_ID)).toBeCloseTo(
      0.07 * STILL_GENERATIONS,
    )
    // And a run still tries it (spec section 9).
    await generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID)
    expect(await lastLedgerModel()).toBe('gemini-9-flash-image')
  })

  it('prices a route nothing resolves at $0 rather than taking the page down, and refuses to spend on it', async () => {
    const route = { provider: 'google' as const, model: 'gemini-unknown-image' }
    await updateSettings(db, {
      modelRouting: { stills: route, stillsLikeness: null, setSheet: route },
    })
    expect(await stillSlotEstimateUsd()).toBe(0)
    expect(await plateEstimateUsd()).toBe(0)
    expect(await setSheetEstimateUsd()).toBe(0)
    expect(await stillsEstimateUsd([{ ...still, depicts: [] }], FIXTURE_PROJECT_ID)).toBe(0)
    await expect(
      generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID),
    ).rejects.toThrow(/does not offer the image model "gemini-unknown-image"/)
  })
})

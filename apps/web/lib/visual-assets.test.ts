// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  deleteCastMember,
  deleteProjectSet,
  insertCastMember,
  insertLogo,
  insertProjectSet,
  listCastMembers,
  listProjectSets,
  requireTestDatabase,
  seed,
  setCastPhotos,
  setSetPlates,
  updateSettings,
} from '@boom-busters/db'
import { LIVE_IMAGE_GEN_ADAPTERS, mockImageGen } from '@boom-busters/providers'
import { STILL_GENERATIONS } from '@boom-busters/schemas'
import type {
  CastMember,
  GraphicBrief,
  ModelRouting,
  ProjectSet,
  StillBrief,
} from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listLedger } from '@boom-busters/cost'
import { db } from '@/lib/db'
import {
  generateStillCandidates,
  referenceBudgets,
  resolveSlotBrief,
  routeForBrief,
  stillsEstimateUsd,
} from './visual-assets'

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

function plate(hash: string, view: 'establishing' | 'detail' | 'other') {
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
    expect(request?.prompt.startsWith('Emad Mostaque, the person in the reference photo.')).toBe(
      true,
    )
    expect(candidates[0]?.references).toEqual(['Emad Mostaque'])
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
    // face the model is not shown must not be named as one it was.
    const tight = vi
      .spyOn(LIVE_IMAGE_GEN_ADAPTERS.google, 'referenceLimits')
      .mockReturnValue({ characters: 1, objects: 0 })
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
      expect(request?.prompt.startsWith('Emad Mostaque, the person in the reference photo.')).toBe(
        true,
      )
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
    const prompt = 'Emad Mostaque, the person in the reference photo, at a podium.'
    await generateStillCandidates({ ...still, prompt }, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.prompt).toBe(prompt)
  })

  it('generates from text alone for a stranger or a member without photos', async () => {
    await insertCastMember(db, { projectId: FIXTURE_PROJECT_ID, name: 'Emad Mostaque', role: 'x' })
    const candidates = await generateStillCandidates(still, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.references).toBeUndefined()
    expect(generate.mock.calls[0]?.[0]?.prompt).toBe(still.prompt)
    expect(candidates[0]?.references).toBeUndefined()

    generate.mockClear()
    await generateStillCandidates({ ...still, depicts: ['Nobody Known'] }, FIXTURE_PROJECT_ID)
    expect(generate.mock.calls[0]?.[0]?.references).toBeUndefined()
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
      await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )

      const sent = generate.mock.calls[0]?.[0].references ?? []
      expect(sent.filter((r) => r.kind === 'character')).toHaveLength(1)
      expect(sent.filter((r) => r.kind === 'object')).toHaveLength(1)
    })

    it('names the room in the prompt, so the model knows which image is which', async () => {
      const room = await insertProjectSet(db, {
        projectId: FIXTURE_PROJECT_ID,
        name: 'Venture Capital Boardroom',
        look: 'A long polished table.',
      })
      await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

      await generateStillCandidates(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        FIXTURE_PROJECT_ID,
      )
      expect(generate.mock.calls[0]?.[0].prompt).toContain(
        'Venture Capital Boardroom, the room in the reference photograph',
      )
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
      await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

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
})

// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  insertCastMember,
  listCastMembers,
  deleteCastMember,
  requireTestDatabase,
  seed,
  setCastPhotos,
  updateSettings,
} from '@boom-busters/db'
import { mockImageGen } from '@boom-busters/providers'
import { STILL_GENERATIONS } from '@boom-busters/schemas'
import type { StillBrief } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listLedger } from '@boom-busters/cost'
import { db } from '@/lib/db'
import { generateStillCandidates, stillsEstimateUsd } from './visual-assets'

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
      { name: 'Emad Mostaque', mimeType: 'image/jpeg', data: expect.any(String) },
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
})

// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  insertCastMember,
  listCastMembers,
  deleteCastMember,
  requireTestDatabase,
  seed,
  setCastPhotos,
} from '@boom-busters/db'
import { mockImageGen } from '@boom-busters/providers'
import type { StillBrief } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { generateStillCandidates } from './visual-assets'

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

describeDb('generateStillCandidates with the cast', () => {
  const generate = vi.spyOn(mockImageGen, 'generate')

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    generate.mockClear()
    await seed(db)
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

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import {
  blockingClaims,
  bumpDossierRevisions,
  countClaims,
  getDossier,
  markDossierApproved,
  saveDossier,
  scriptableClaims,
  setClaimQuarantined,
  verifyClaim,
} from './dossiers'
import { createProjectFromCase } from './projects'
import { requireTestDatabase } from './test-database'

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('dossiers and claims', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    const source = await createCase(db, { title: 'Enron', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Enron' })
    projectId = project.id
  })

  const claims = [
    {
      text: 'Sourced and checkable.',
      sourceUrl: 'https://example.com/a',
      sourceType: 'court' as const,
      confidence: 'sourced' as const,
    },
    {
      text: 'Nobody could attribute this one.',
      sourceType: 'other' as const,
      confidence: 'unverified' as const,
    },
  ]

  it('writes the dossier and its claims together', async () => {
    const saved = await saveDossier(db, { projectId, contentMd: '# Enron', claims })

    expect(saved.contentMd).toBe('# Enron')
    expect(saved.claims).toHaveLength(2)
  })

  it('replaces claims on a re-run rather than accumulating them', async () => {
    await saveDossier(db, { projectId, contentMd: '# v1', claims })
    const revised = await saveDossier(db, {
      projectId,
      contentMd: '# v2',
      claims: [claims[0]!],
    })

    // Merging would silently keep a claim the new research dropped.
    expect(revised.claims).toHaveLength(1)
    expect(revised.contentMd).toBe('# v2')
  })

  it('keeps one dossier per project across re-runs', async () => {
    await saveDossier(db, { projectId, contentMd: '# v1', claims })
    await saveDossier(db, { projectId, contentMd: '# v2', claims })

    expect((await getDossier(db, projectId))?.contentMd).toBe('# v2')
  })

  it('floats unverified claims to the top of the review table', async () => {
    const saved = await saveDossier(db, { projectId, contentMd: '#', claims })

    expect(saved.claims[0]?.confidence).toBe('unverified')
  })

  describe('the approval blocker', () => {
    it('reports an unverified claim as blocking', async () => {
      await saveDossier(db, { projectId, contentMd: '#', claims })

      const blocking = await blockingClaims(db, projectId)
      expect(blocking).toHaveLength(1)
      expect(blocking[0]?.text).toMatch(/Nobody could attribute/)
    })

    it('clears once the claim is quarantined', async () => {
      const saved = await saveDossier(db, { projectId, contentMd: '#', claims })
      const unverified = saved.claims.find((c) => c.confidence === 'unverified')!

      await setClaimQuarantined(db, unverified.id, true)

      expect(await blockingClaims(db, projectId)).toHaveLength(0)
    })

    it('clears once the human verifies it against a source', async () => {
      const saved = await saveDossier(db, { projectId, contentMd: '#', claims })
      const unverified = saved.claims.find((c) => c.confidence === 'unverified')!

      await verifyClaim(db, unverified.id, {
        sourceUrl: 'https://example.com/checked',
        sourceType: 'regulator',
        confidence: 'single_source',
      })

      expect(await blockingClaims(db, projectId)).toHaveLength(0)
    })

    it('is empty for a project with no dossier at all', async () => {
      expect(await blockingClaims(db, projectId)).toEqual([])
    })
  })

  describe('scriptableClaims', () => {
    it('excludes quarantined claims — the rule the script depends on', async () => {
      const saved = await saveDossier(db, { projectId, contentMd: '#', claims })
      await setClaimQuarantined(db, saved.claims[0]!.id, true)

      const scriptable = await scriptableClaims(db, projectId)

      expect(scriptable).toHaveLength(1)
      expect(scriptable.every((c) => !c.quarantined)).toBe(true)
    })

    it('includes an unverified claim the human chose to keep', async () => {
      // Not quarantined means the human looked at it and left it in. That is
      // their call to make, and the self-check pass warns about it later.
      await saveDossier(db, { projectId, contentMd: '#', claims })

      expect(await scriptableClaims(db, projectId)).toHaveLength(2)
    })
  })

  it('stamps approval', async () => {
    await saveDossier(db, { projectId, contentMd: '#', claims })
    await markDossierApproved(db, projectId)

    expect((await getDossier(db, projectId))?.approvedAt).toBeInstanceOf(Date)
  })

  it('counts revisions so the reviser can stop', async () => {
    await saveDossier(db, { projectId, contentMd: '#', claims })

    expect(await bumpDossierRevisions(db, projectId)).toBe(1)
    expect(await bumpDossierRevisions(db, projectId)).toBe(2)
  })

  it('cascades away with its project', async () => {
    await saveDossier(db, { projectId, contentMd: '#', claims })
    await truncateCases(db)

    expect(await getDossier(db, projectId)).toBeUndefined()
  })
})

describe('countClaims', () => {
  const row = (over: Record<string, unknown>) =>
    ({
      confidence: 'sourced',
      quarantined: false,
      ...over,
    }) as never

  it('separates blocking from merely unverified', () => {
    const counts = countClaims([
      row({ confidence: 'unverified' }),
      row({ confidence: 'unverified', quarantined: true }),
      row({}),
    ])

    expect(counts).toEqual({ total: 3, unverified: 2, quarantined: 1, blocking: 1 })
  })

  it('is all zeroes for no claims', () => {
    expect(countClaims([])).toEqual({ total: 0, unverified: 0, quarantined: 0, blocking: 0 })
  })
})

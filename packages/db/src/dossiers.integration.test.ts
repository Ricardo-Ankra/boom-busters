import type { GroundedResearch } from '@boom-busters/schemas'
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
  setClaimSourceUrl,
  verifyClaim,
} from './dossiers'
import { createProjectFromCase } from './projects'
import { upsertResearchDocument } from './research-documents'
import { researchDocuments } from './schema'
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

  // Decision 280: the headline card points a claim at its article.
  it('points a claim at its article, keeping its type and confidence', async () => {
    const saved = await saveDossier(db, { projectId, contentMd: '#', claims })
    const claim = saved.claims[0]!
    const updated = await setClaimSourceUrl(db, claim.id, 'https://example.com/2023/10/the-article')
    expect(updated).toMatchObject({
      sourceUrl: 'https://example.com/2023/10/the-article',
      sourceType: claim.sourceType,
      confidence: claim.confidence,
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

  it('starts the revision count again on approval, so a later request is a new review', async () => {
    await saveDossier(db, { projectId, contentMd: '#', claims })
    await bumpDossierRevisions(db, projectId)
    await bumpDossierRevisions(db, projectId)
    await bumpDossierRevisions(db, projectId)

    await markDossierApproved(db, projectId)

    expect(await bumpDossierRevisions(db, projectId)).toBe(1)
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

suite('dossier research, supports and legal status', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    await db.delete(researchDocuments)
    const source = await createCase(db, { title: 'Wirecard', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Wirecard' })
    projectId = project.id
  })

  const plain = [
    { text: 'A claim.', sourceType: 'other' as const, confidence: 'unverified' as const },
  ]

  function makeDoc() {
    return upsertResearchDocument(db, {
      url: 'https://example.com/a',
      finalUrl: null,
      httpStatus: 200,
      fetchedAt: new Date(),
      contentType: 'text/html',
      kind: 'reporting',
      tier: 2,
      title: null,
      publishedAt: null,
      text: 'filed for insolvency',
      textHash: null,
      tokens: 3,
      archivedUrl: null,
      truncated: false,
      failure: null,
      meta: null,
    })
  }

  const support = (documentId: string, quote: string) => ({
    documentId,
    rank: 1,
    quote,
    found: true,
    offset: 12,
    locatorSeconds: null,
  })

  it('saves supports, legal status and series with a claim and reads them back', async () => {
    const a = await makeDoc()
    const saved = await saveDossier(db, {
      projectId,
      contentMd: '# x',
      research: null,
      claims: [
        {
          text: 'Wirecard filed for insolvency in June 2020.',
          sourceUrl: 'https://example.com/a',
          sourceType: 'major_outlet',
          confidence: 'single_source',
          legalStatus: 'alleged',
          legalStatusDate: '2020-06',
          legalStatusDocumentId: a.id,
          series: null,
          supports: [support(a.id, 'filed for insolvency')],
        },
      ],
    })
    const claim = saved.claims[0]!
    expect(claim.legalStatus).toBe('alleged')
    expect(claim.legalStatusDate).toBe('2020-06')
    expect(claim.legalStatusDocumentId).toBe(a.id)
    expect(saved.supports[claim.id]?.[0]?.quote).toBe('filed for insolvency')
  })

  it('defaults legal status to none and supports to empty', async () => {
    const saved = await saveDossier(db, { projectId, contentMd: '# x', claims: plain })
    expect(saved.claims[0]!.legalStatus).toBe('none')
    expect(saved.supports[saved.claims[0]!.id] ?? []).toEqual([])
    expect(saved.research).toBeNull()
  })

  it('replaces supports when the dossier is saved again', async () => {
    const a = await makeDoc()
    const withSupport = (quote: string) => [{ ...plain[0]!, supports: [support(a.id, quote)] }]
    await saveDossier(db, { projectId, contentMd: '# v1', claims: withSupport('first') })
    const second = await saveDossier(db, {
      projectId,
      contentMd: '# v2',
      claims: withSupport('second'),
    })
    expect(
      Object.values(second.supports)
        .flat()
        .map((s) => s.quote),
    ).toEqual(['second'])
  })

  it('keeps the previous dossier when a support names a missing document', async () => {
    const a = await makeDoc()
    const claim = { ...plain[0]!, supports: [support(a.id, 'kept')] }
    await saveDossier(db, { projectId, contentMd: '# v1', claims: [claim] })
    await expect(
      saveDossier(db, {
        projectId,
        contentMd: '# v2',
        claims: [{ ...plain[0]!, supports: [support('01MISSINGDOCUMENT0000000', 'lost')] }],
      }),
    ).rejects.toThrow()
    const kept = (await getDossier(db, projectId))!
    expect(kept.contentMd).toBe('# v1')
    expect(kept.claims).toHaveLength(1)
    expect(
      Object.values(kept.supports)
        .flat()
        .map((s) => s.quote),
    ).toEqual(['kept'])
  })

  it('stores and returns research, and clears it with null', async () => {
    const research = { entity: { label: 'Wirecard AG' } } as unknown as GroundedResearch
    const saved = await saveDossier(db, { projectId, contentMd: '# x', claims: plain, research })
    expect(saved.research).toEqual(research)
    const cleared = await saveDossier(db, {
      projectId,
      contentMd: '# x',
      claims: plain,
      research: null,
    })
    expect(cleared.research).toBeNull()
  })

  it('reads research saved before the subject fields with their defaults', async () => {
    // The shape a dossier written before people, unresolved, subject and
    // currentStatus existed has in the column.
    const old = {
      entity: { qid: 'Q1', titles: ['Wirecard'], cik: null, ticker: 'WDI', website: null },
      brief: {
        summary: 'Wirecard was a payments company that reported cash it did not have.',
        turningPoint: 'The auditors could not find the money.',
        cast: [],
        toldAlready: [],
        openQuestions: [],
      },
      scenes: [],
      answers: [],
      corpus: { read: 3, unread: 0, failed: 0 },
    } as unknown as GroundedResearch
    await saveDossier(db, { projectId, contentMd: '# x', claims: plain, research: old })

    const read = (await getDossier(db, projectId))!.research!
    expect(read.entity).toMatchObject({
      qid: 'Q1',
      people: [],
      unresolved: false,
      subject: null,
    })
    expect(read.brief.currentStatus).toBeNull()
  })
})

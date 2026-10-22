import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import {
  findResearchDocumentsByUrl,
  getResearchDocuments,
  linkDossierDocuments,
  listDossierDocumentSummaries,
  listDossierDocuments,
  normaliseDocumentUrl,
  upsertResearchDocument,
} from './research-documents'
import { researchDocuments } from './schema'
import { requireTestDatabase } from './test-database'

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function doc(over: { url: string; text?: string; tier?: number }) {
  return {
    url: over.url,
    finalUrl: null,
    httpStatus: 200,
    fetchedAt: new Date('2026-10-22T00:00:00Z'),
    contentType: 'text/html',
    kind: 'reporting' as const,
    tier: over.tier ?? 2,
    title: null,
    publishedAt: null,
    text: over.text ?? '',
    textHash: null,
    tokens: 0,
    archivedUrl: null,
    truncated: false,
    failure: null,
    meta: null,
  }
}

suite('research documents', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    await db.delete(researchDocuments)
    const source = await createCase(db, { title: 'Enron', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Enron' })
    projectId = project.id
  })

  it('upserts by url and keeps the id', async () => {
    const first = await upsertResearchDocument(
      db,
      doc({ url: 'https://example.com/a', text: 'one' }),
    )
    const second = await upsertResearchDocument(
      db,
      doc({ url: 'https://example.com/a', text: 'two' }),
    )
    expect(second.id).toBe(first.id)
    expect(second.text).toBe('two')
  })

  it('clears omitted optional fields on a refetch', async () => {
    const base = doc({ url: 'https://example.com/a' })
    await upsertResearchDocument(db, {
      ...base,
      failure: 'timeout',
      finalUrl: 'https://example.com/final',
    })
    const { failure: _failure, finalUrl: _finalUrl, ...rest } = base
    const again = await upsertResearchDocument(db, rest)
    expect(again.failure).toBeNull()
    expect(again.finalUrl).toBeNull()
  })

  it('reads documents back by id and by url', async () => {
    const a = await upsertResearchDocument(db, doc({ url: 'https://example.com/a' }))
    await upsertResearchDocument(db, doc({ url: 'https://example.com/b' }))
    expect((await getResearchDocuments(db, [a.id])).map((r) => r.url)).toEqual([
      'https://example.com/a',
    ])
    expect(await getResearchDocuments(db, [])).toEqual([])
    expect(await findResearchDocumentsByUrl(db, ['https://example.com/b'])).toHaveLength(1)
    expect(await findResearchDocumentsByUrl(db, [])).toEqual([])
  })

  it('links and lists a project corpus with unread rows last', async () => {
    const a = await upsertResearchDocument(db, doc({ url: 'https://example.com/a', tier: 1 }))
    const b = await upsertResearchDocument(db, doc({ url: 'https://example.com/b' }))
    await linkDossierDocuments(db, projectId, [
      { documentId: b.id, rank: null, tier: 2 },
      { documentId: a.id, rank: 1, tier: 1 },
    ])
    const rows = await listDossierDocuments(db, projectId)
    expect(rows.map((r) => r.rank)).toEqual([1, null])

    await linkDossierDocuments(db, projectId, [{ documentId: b.id, rank: 1, tier: 2 }])
    expect((await listDossierDocuments(db, projectId)).map((r) => r.id)).toEqual([b.id])
  })

  it('lists a corpus without its text, in the same order', async () => {
    const a = await upsertResearchDocument(db, {
      ...doc({ url: 'https://example.com/a', text: 'a long body', tier: 1 }),
      title: 'A',
      archivedUrl: 'https://web.archive.org/web/2019/https://example.com/a',
    })
    const b = await upsertResearchDocument(db, {
      ...doc({ url: 'https://example.com/b' }),
      failure: 'could not fetch: returned 404',
    })
    await linkDossierDocuments(db, projectId, [
      { documentId: b.id, rank: null, tier: 2 },
      { documentId: a.id, rank: 1, tier: 1 },
    ])
    expect(await listDossierDocumentSummaries(db, projectId)).toEqual([
      {
        id: a.id,
        url: 'https://example.com/a',
        title: 'A',
        kind: 'reporting',
        rank: 1,
        tier: 1,
        failure: null,
        archivedUrl: 'https://web.archive.org/web/2019/https://example.com/a',
      },
      {
        id: b.id,
        url: 'https://example.com/b',
        title: null,
        kind: 'reporting',
        rank: null,
        tier: 2,
        failure: 'could not fetch: returned 404',
        archivedUrl: null,
      },
    ])
  })

  it('keeps the old corpus when the new links cannot be written', async () => {
    const a = await upsertResearchDocument(db, doc({ url: 'https://example.com/a' }))
    await linkDossierDocuments(db, projectId, [{ documentId: a.id, rank: 1, tier: 2 }])
    await expect(
      linkDossierDocuments(db, projectId, [
        { documentId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', rank: 1, tier: 2 },
      ]),
    ).rejects.toThrow()
    expect((await listDossierDocuments(db, projectId)).map((r) => r.id)).toEqual([a.id])
  })

  it('normalises urls', () => {
    expect(normaliseDocumentUrl('HTTPS://WWW.Example.com/Path/?utm_source=x&id=2#frag')).toBe(
      'https://www.example.com/Path/?id=2',
    )
    expect(normaliseDocumentUrl('https://Example.com/')).toBe('https://example.com')
  })
})

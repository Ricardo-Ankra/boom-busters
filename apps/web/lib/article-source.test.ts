import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArticleSourceRow } from '@boom-busters/db'

const stored = vi.hoisted(() => ({ rows: new Map<string, ArticleSourceRow>() }))

const dbHelpers = vi.hoisted(() => ({
  getArticleSource: vi.fn(),
  getClaim: vi.fn(),
  recordArticleSource: vi.fn(),
}))

const provider = vi.hoisted(() => ({ fetchMetadata: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@boom-busters/db', () => dbHelpers)
vi.mock('@boom-busters/providers', () => ({ articleProvider: () => provider }))

import { articleForClaim, refetchArticle } from './article-source'

const URL_RAW = 'https://www.financialrecord.example/2023/03/14/auditors?utm_source=x'
const URL_KEY = 'https://financialrecord.example/2023/03/14/auditors'

function row(overrides: Partial<ArticleSourceRow> = {}): ArticleSourceRow {
  return {
    url: URL_KEY,
    outlet: 'The Financial Record',
    headline: 'Auditors cannot find the $1.9 billion the company says it holds',
    author: 'Elena Marsh',
    publishedAt: '2023-03-14',
    description: null,
    provenance: { headline: 'jsonld' },
    status: 'fetched',
    failureReason: null,
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ArticleSourceRow
}

beforeEach(() => {
  vi.clearAllMocks()
  stored.rows.clear()
  dbHelpers.getArticleSource.mockImplementation((_db: unknown, url: string) =>
    Promise.resolve(stored.rows.get(url)),
  )
  dbHelpers.recordArticleSource.mockImplementation(
    (_db: unknown, meta: Record<string, unknown>) => {
      const existing = stored.rows.get(meta['url'] as string)
      if (existing?.status === 'manual') return Promise.resolve(existing)
      const written = row({ ...(meta as Partial<ArticleSourceRow>) })
      stored.rows.set(written.url, written)
      return Promise.resolve(written)
    },
  )
  dbHelpers.getClaim.mockResolvedValue({ id: 'claim-1', sourceUrl: URL_RAW })
  provider.fetchMetadata.mockResolvedValue({
    outlet: 'The Financial Record',
    headline: 'Auditors cannot find the $1.9 billion the company says it holds',
    author: 'Elena Marsh',
    publishedAt: '2023-03-14',
    description: null,
    provenance: { headline: 'jsonld' },
    archived: false,
  })
})

describe('articleForClaim', () => {
  it('reads the page once and keys the record by the normalised address', async () => {
    const article = await articleForClaim('claim-1')
    expect(article?.headline).toContain('Auditors cannot find')
    expect(article?.url).toBe(URL_KEY)
    expect(provider.fetchMetadata).toHaveBeenCalledWith(URL_KEY)
  })

  it('does not open the page again once a record exists', async () => {
    stored.rows.set(URL_KEY, row())
    const article = await articleForClaim('claim-1')
    expect(article?.outlet).toBe('The Financial Record')
    expect(provider.fetchMetadata).not.toHaveBeenCalled()
  })

  it('never re-reads a record the owner corrected', async () => {
    stored.rows.set(URL_KEY, row({ status: 'manual', headline: 'What the owner typed' }))
    const article = await articleForClaim('claim-1')
    expect(article?.headline).toBe('What the owner typed')
    expect(provider.fetchMetadata).not.toHaveBeenCalled()
  })

  it('stores why the page would not answer, rather than throwing', async () => {
    provider.fetchMetadata.mockRejectedValue(new Error('The publisher returned 403'))
    const article = await articleForClaim('claim-1')
    expect(article?.status).toBe('failed')
    expect(article?.failureReason).toBe('The publisher returned 403')
    expect(article?.headline).toBeNull()
  })

  it('tries a failed record again, because a timeout is not a paywall', async () => {
    stored.rows.set(URL_KEY, row({ status: 'failed', headline: null, outlet: null }))
    await articleForClaim('claim-1')
    expect(provider.fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it('has no article for a claim with no source to read', async () => {
    dbHelpers.getClaim.mockResolvedValue({ id: 'claim-1', sourceUrl: null })
    expect(await articleForClaim('claim-1')).toBeNull()

    dbHelpers.getClaim.mockResolvedValue({ id: 'claim-1', sourceUrl: 'FT, June 2020' })
    expect(await articleForClaim('claim-1')).toBeNull()

    dbHelpers.getClaim.mockResolvedValue(undefined)
    expect(await articleForClaim('claim-1')).toBeNull()
  })
})

describe('refetchArticle', () => {
  it('reads the page again', async () => {
    stored.rows.set(URL_KEY, row({ status: 'failed', headline: null }))
    const article = await refetchArticle(URL_RAW)
    expect(article.headline).toContain('Auditors cannot find')
    expect(provider.fetchMetadata).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite what the owner typed', async () => {
    stored.rows.set(URL_KEY, row({ status: 'manual', headline: 'What the owner typed' }))
    const article = await refetchArticle(URL_RAW)
    expect(article.headline).toBe('What the owner typed')
    expect(provider.fetchMetadata).not.toHaveBeenCalled()
  })

  it('refuses text that is not an address', async () => {
    await expect(refetchArticle('FT, June 2020')).rejects.toThrow(/not a web address/)
  })
})

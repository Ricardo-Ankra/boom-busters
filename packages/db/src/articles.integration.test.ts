import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ArticleMetadata } from '@boom-busters/schemas'
import {
  getArticleSource,
  getArticleSources,
  recordArticleSource,
  setArticleSourceManual,
} from './articles'
import { createDb } from './client'
import { articleSources } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The article store against a real database (decision 257). The rule worth
 * proving is the sticky one: a record the owner corrected must survive every
 * later fetch, because the correction usually exists precisely because the
 * page would not say.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const URL_A = 'https://financialrecord.example/2023/03/14/auditors'

const FETCHED: ArticleMetadata = {
  url: URL_A,
  outlet: 'The Financial Record',
  headline: 'Auditors cannot find the $1.9 billion the company says it holds',
  author: 'Elena Marsh',
  publishedAt: '2023-03-14',
  description: null,
  provenance: { headline: 'jsonld', outlet: 'og', author: 'meta', publishedAt: 'jsonld' },
  status: 'fetched',
  failureReason: null,
}

const FAILED: ArticleMetadata = {
  url: 'https://paywalled.example/story',
  outlet: null,
  headline: null,
  author: null,
  publishedAt: null,
  description: null,
  provenance: {},
  status: 'failed',
  failureReason: 'The publisher returned 403',
}

suite('the article store', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${articleSources} restart identity cascade`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores what a fetch found, and reads it back by url', async () => {
    await recordArticleSource(db, FETCHED)
    const row = await getArticleSource(db, URL_A)
    expect(row?.headline).toBe(FETCHED.headline)
    expect(row?.provenance['headline']).toBe('jsonld')
    expect(row?.status).toBe('fetched')
  })

  it('stores a failure rather than discarding it', async () => {
    await recordArticleSource(db, FAILED)
    const row = await getArticleSource(db, FAILED.url)
    expect(row?.status).toBe('failed')
    expect(row?.failureReason).toBe('The publisher returned 403')
  })

  it('updates a fetched row on a later fetch', async () => {
    await recordArticleSource(db, FETCHED)
    await recordArticleSource(db, { ...FETCHED, headline: 'A corrected headline' })
    expect((await getArticleSource(db, URL_A))?.headline).toBe('A corrected headline')
  })

  it('never lets a fetch overwrite what the owner typed', async () => {
    await recordArticleSource(db, FAILED)
    await setArticleSourceManual(db, FAILED.url, {
      outlet: 'The Daily Ledger',
      headline: 'Regulator opens inquiry into missing escrow',
      publishedAt: '2023-06-02',
    })

    const written = await recordArticleSource(db, {
      ...FETCHED,
      url: FAILED.url,
      headline: 'Whatever the page says now',
    })

    expect(written.status).toBe('manual')
    expect(written.headline).toBe('Regulator opens inquiry into missing escrow')
    expect(written.outlet).toBe('The Daily Ledger')
  })

  it('marks the fields the owner wrote, and clears the failure', async () => {
    await recordArticleSource(db, FAILED)
    const row = await setArticleSourceManual(db, FAILED.url, { outlet: 'The Daily Ledger' })
    expect(row.provenance['outlet']).toBe('manual')
    expect(row.failureReason).toBeNull()
    expect(row.status).toBe('manual')
  })

  it('leaves absent fields alone and clears the ones set to null', async () => {
    await recordArticleSource(db, FETCHED)
    const row = await setArticleSourceManual(db, URL_A, { author: null })
    expect(row.headline).toBe(FETCHED.headline)
    expect(row.author).toBeNull()
    expect(row.provenance['author']).toBeUndefined()
    expect(row.provenance['headline']).toBe('jsonld')
  })

  it('reads several articles at once, and nothing for an empty list', async () => {
    await recordArticleSource(db, FETCHED)
    await recordArticleSource(db, FAILED)
    const rows = await getArticleSources(db, [URL_A, FAILED.url, 'https://absent.example/x'])
    expect(rows).toHaveLength(2)
    expect(await getArticleSources(db, [])).toEqual([])
  })
})

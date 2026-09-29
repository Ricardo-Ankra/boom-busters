import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { SocialPostRecord } from '@boom-busters/schemas'
import { createDb } from './client'
import { socialPosts } from './schema'
import { eq } from 'drizzle-orm'
import {
  getSocialPost,
  getSocialPosts,
  recordSocialPost,
  setSocialPostManual,
} from './social-posts'
import { requireTestDatabase } from './test-database'

/**
 * The social post store against a real database (decision 284). Mirrors the
 * article store's sticky-correction rule, but per field rather than per row:
 * a fetch fills in whatever the owner has not typed, and never touches what
 * they have.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const URL_A = 'https://x.com/i/status/1900000000000000001'
const URL_B = 'https://x.com/i/status/1900000000000000002'

const FETCHED: SocialPostRecord = {
  url: URL_A,
  platform: 'x',
  postId: '1900000000000000001',
  handle: 'EMostaque',
  authorName: 'Emad Mostaque',
  text: 'Stability AI is out of money.',
  postedAt: '2023-03-14',
  endedWithMediaLink: false,
  provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
  status: 'fetched',
  failureReason: null,
}

const FAILED: SocialPostRecord = {
  url: URL_B,
  platform: 'x',
  postId: '1900000000000000002',
  handle: null,
  authorName: null,
  text: null,
  postedAt: null,
  endedWithMediaLink: false,
  provenance: {},
  status: 'failed',
  failureReason: 'X says this post does not exist or is not public.',
}

suite('the social post store', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${socialPosts} restart identity cascade`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores what a fetch found, and reads it back by url', async () => {
    await recordSocialPost(db, FETCHED)
    const row = await getSocialPost(db, URL_A)
    expect(row?.text).toBe(FETCHED.text)
    expect(row?.provenance['text']).toBe('oembed')
    expect(row?.status).toBe('fetched')
  })

  it('stores a failure rather than discarding it', async () => {
    await recordSocialPost(db, FAILED)
    const row = await getSocialPost(db, URL_B)
    expect(row?.status).toBe('failed')
    expect(row?.failureReason).toBe('X says this post does not exist or is not public.')
  })

  it('records twice, updating fetched_at', async () => {
    await recordSocialPost(db, FETCHED)
    const [firstRow] = await db.select().from(socialPosts).where(eq(socialPosts.url, URL_A))

    await new Promise((resolve) => setTimeout(resolve, 5))
    await recordSocialPost(db, { ...FETCHED, text: 'A corrected read of the same post.' })
    const [secondRow] = await db.select().from(socialPosts).where(eq(socialPosts.url, URL_A))

    expect(secondRow?.text).toBe('A corrected read of the same post.')
    expect(firstRow?.fetchedAt).toBeDefined()
    expect(secondRow?.fetchedAt).toBeDefined()
    expect(secondRow!.fetchedAt.getTime()).toBeGreaterThan(firstRow!.fetchedAt.getTime())
  })

  it('never lets a fetch overwrite what the owner typed, but takes the rest', async () => {
    await recordSocialPost(db, FETCHED)
    await setSocialPostManual(db, URL_A, { text: "The owner's own transcription." })

    const written = await recordSocialPost(db, {
      ...FETCHED,
      text: 'Whatever the reader says now',
      postedAt: '2024-01-01',
      provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
    })

    expect(written.text).toBe("The owner's own transcription.")
    expect(written.provenance['text']).toBe('manual')
    expect(written.postedAt).toBe('2024-01-01')
    expect(written.provenance['postedAt']).toBe('oembed')
  })

  it('never replaces a stored field with a blank the reader came back with', async () => {
    await recordSocialPost(db, FETCHED)

    const written = await recordSocialPost(db, {
      ...FETCHED,
      authorName: null,
      text: null,
      postedAt: '2024-01-01',
      provenance: { handle: 'oembed', postedAt: 'oembed' },
    })

    expect(written.authorName).toBe(FETCHED.authorName)
    expect(written.provenance['authorName']).toBe('oembed')
    expect(written.text).toBe(FETCHED.text)
    expect(written.provenance['text']).toBe('oembed')
    // What the reader did answer still lands.
    expect(written.postedAt).toBe('2024-01-01')
  })

  it('creates the row from the address when the owner types a post nobody has read', async () => {
    const row = await setSocialPostManual(db, URL_A, {
      authorName: 'Emad Mostaque',
      text: 'Typed before any read.',
    })

    expect(row).toMatchObject({
      url: URL_A,
      platform: 'x',
      postId: '1900000000000000001',
      authorName: 'Emad Mostaque',
      text: 'Typed before any read.',
      handle: null,
      postedAt: null,
      status: 'manual',
      failureReason: null,
      endedWithMediaLink: false,
      provenance: { authorName: 'manual', text: 'manual' },
    })
    expect(await getSocialPost(db, URL_A)).toEqual(row)
  })

  it('marks the fields the owner wrote, and clears the failure', async () => {
    await recordSocialPost(db, FAILED)
    const row = await setSocialPostManual(db, URL_B, { authorName: 'A Name Typed By Hand' })
    expect(row.provenance['authorName']).toBe('manual')
    expect(row.failureReason).toBeNull()
    expect(row.status).toBe('manual')
  })

  it('leaves absent fields alone and clears the ones set to null', async () => {
    await recordSocialPost(db, FETCHED)
    const row = await setSocialPostManual(db, URL_A, { handle: null })
    expect(row.text).toBe(FETCHED.text)
    expect(row.handle).toBeNull()
    expect(row.provenance['handle']).toBeUndefined()
    expect(row.provenance['text']).toBe('oembed')
  })

  it('reads several posts at once, and nothing for an empty list', async () => {
    await recordSocialPost(db, FETCHED)
    await recordSocialPost(db, FAILED)
    const rows = await getSocialPosts(db, [URL_A, URL_B, 'https://x.com/i/status/9999999999999999'])
    expect(rows).toHaveLength(2)
    expect(await getSocialPosts(db, [])).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SocialPostRow } from '@boom-busters/db'
import { ValidationError } from '@boom-busters/schemas'

const stored = vi.hoisted(() => ({ rows: new Map<string, SocialPostRow>() }))

const dbHelpers = vi.hoisted(() => ({
  getSocialPost: vi.fn(),
  recordSocialPost: vi.fn(),
}))

const provider = vi.hoisted(() => ({ fetchPost: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@boom-busters/db', () => dbHelpers)
vi.mock('@boom-busters/providers', () => ({ socialProvider: () => provider }))

import { postForUrl, refetchPost } from './social-source'

const URL_RAW = 'https://x.com/emad_mostaque/status/1234567890123456789'
const URL_KEY = 'https://x.com/i/status/1234567890123456789'

function row(overrides: Partial<SocialPostRow> = {}): SocialPostRow {
  return {
    url: URL_KEY,
    platform: 'x',
    postId: '1234567890123456789',
    handle: 'emad_mostaque',
    authorName: 'Emad Mostaque',
    text: 'Stepping down as CEO of Stability AI.',
    postedAt: '2024-01-01',
    endedWithMediaLink: false,
    provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
    status: 'fetched',
    failureReason: null,
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as SocialPostRow
}

beforeEach(() => {
  vi.clearAllMocks()
  stored.rows.clear()
  dbHelpers.getSocialPost.mockImplementation((_db: unknown, url: string) =>
    Promise.resolve(stored.rows.get(url)),
  )
  dbHelpers.recordSocialPost.mockImplementation((_db: unknown, record: Record<string, unknown>) => {
    const existing = stored.rows.get(record['url'] as string)
    const provenance = (existing?.provenance ?? {}) as Record<string, string>
    const field = (key: string) =>
      provenance[key] === 'manual'
        ? (existing as Record<string, unknown>)[key]
        : (record as Record<string, unknown>)[key]
    const written = row({
      ...(record as Partial<SocialPostRow>),
      authorName: field('authorName') as string | null,
      handle: field('handle') as string | null,
      text: field('text') as string | null,
      postedAt: field('postedAt') as string | null,
    })
    stored.rows.set(written.url, written)
    return Promise.resolve(written)
  })
  provider.fetchPost.mockResolvedValue({
    authorName: 'Emad Mostaque',
    handle: 'emad_mostaque',
    text: 'Stepping down as CEO of Stability AI.',
    postedAt: '2024-01-01',
    endedWithMediaLink: false,
  })
})

describe('postForUrl', () => {
  it('does not read the post again once a record exists', async () => {
    stored.rows.set(URL_KEY, row())
    const post = await postForUrl(URL_RAW)
    expect(post?.text).toBe('Stepping down as CEO of Stability AI.')
    expect(provider.fetchPost).not.toHaveBeenCalled()
  })

  it('reads a missing row and stores it, keyed by the normalised address', async () => {
    const post = await postForUrl(URL_RAW)
    expect(post?.authorName).toBe('Emad Mostaque')
    expect(post?.status).toBe('fetched')
    expect(provider.fetchPost).toHaveBeenCalledWith(URL_RAW)
    expect(stored.rows.get(URL_KEY)?.text).toBe('Stepping down as CEO of Stability AI.')
  })

  it('stores a 404 as a failed row, with the handle and id taken from the address', async () => {
    provider.fetchPost.mockRejectedValue(
      new ValidationError('X says this post does not exist or is not public.'),
    )
    const post = await postForUrl(URL_RAW)
    expect(post).toMatchObject({
      status: 'failed',
      failureReason: 'X says this post does not exist or is not public.',
      handle: 'emad_mostaque',
      postId: '1234567890123456789',
      authorName: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
  })

  it('is null for an address that is not a post', async () => {
    expect(await postForUrl('https://example.com/not-a-post')).toBeNull()
    expect(provider.fetchPost).not.toHaveBeenCalled()
  })
})

describe('refetchPost', () => {
  it('reads the post again even when a row already exists', async () => {
    stored.rows.set(URL_KEY, row())
    await refetchPost(URL_RAW)
    expect(provider.fetchPost).toHaveBeenCalledTimes(1)
  })

  it('keeps what the owner typed for a field the reader could not answer', async () => {
    stored.rows.set(URL_KEY, row({ text: 'What the owner typed', provenance: { text: 'manual' } }))
    const post = await refetchPost(URL_RAW)
    expect(post.text).toBe('What the owner typed')
    expect(post.authorName).toBe('Emad Mostaque')
  })

  // The controller ruling: a failed re-read must not wipe a post that was
  // already read. A stored good post, a refetch whose reader throws
  // X_UNREACHABLE, and the row still holds its text afterwards.
  it('leaves a stored post untouched when the re-read fails', async () => {
    stored.rows.set(URL_KEY, row())
    provider.fetchPost.mockRejectedValue(
      new ValidationError('X did not answer. Try Read again, or type the details.'),
    )

    await expect(refetchPost(URL_RAW)).rejects.toThrow(/X did not answer/)

    expect(dbHelpers.recordSocialPost).not.toHaveBeenCalled()
    expect(stored.rows.get(URL_KEY)?.text).toBe('Stepping down as CEO of Stability AI.')
    expect(stored.rows.get(URL_KEY)?.status).toBe('fetched')
  })

  it('stores a first failed read rather than throwing, when there was no row yet', async () => {
    provider.fetchPost.mockRejectedValue(
      new ValidationError('X did not answer. Try Read again, or type the details.'),
    )
    const post = await refetchPost(URL_RAW)
    expect(post.status).toBe('failed')
    expect(post.failureReason).toBe('X did not answer. Try Read again, or type the details.')
  })

  it('refuses text that is not an address', async () => {
    await expect(refetchPost('FT, June 2020')).rejects.toThrow(/not a link to a post/)
  })
})

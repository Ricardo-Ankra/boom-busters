import type { SocialProvider } from './fetch'

/**
 * `MOCK_PROVIDERS=1`: a deterministic post, no socket (spec section 13).
 * Derived from the URL so e2e can assert on what it gets, and so two
 * different claims do not produce the same card.
 */
export const mockSocialProvider: SocialProvider = {
  fetchPost(publicUrl) {
    const segments = new URL(publicUrl).pathname.split('/').filter(Boolean)
    const handle = segments[0] ?? 'someone'
    const id = segments.at(-1) ?? '0'
    const authorName = handle
      .replace(/[-_]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    return Promise.resolve({
      authorName: authorName === '' ? handle : authorName,
      handle,
      text: `Mock post ${id}, for board previews and e2e runs.`,
      postedAt: '2024-01-01',
      endedWithMediaLink: false,
    })
  },
}

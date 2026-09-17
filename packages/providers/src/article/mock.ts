import type { ArticleProvider } from './fetch'

/**
 * `MOCK_PROVIDERS=1`: deterministic article metadata, no socket (spec section
 * 13). Derived from the URL so e2e can assert on what it gets, and so two
 * different claims do not produce the same card.
 *
 * A URL containing `paywall` fails, because the manual path is the one the
 * board has to get right and it needs a way to be exercised offline.
 */
export const mockArticleProvider: ArticleProvider = {
  fetchMetadata(url) {
    if (url.includes('paywall')) {
      return Promise.reject(new Error('The publisher returned 403'))
    }

    const slug = (new URL(url).pathname.split('/').filter(Boolean).pop() ?? 'story').replace(
      /[-_]+/g,
      ' ',
    )
    const outlet = new URL(url).hostname.replace(/^www\./, '').split('.')[0] ?? 'news'

    return Promise.resolve({
      outlet: `The ${outlet.charAt(0).toUpperCase()}${outlet.slice(1)}`,
      headline: `${slug.charAt(0).toUpperCase()}${slug.slice(1)}, and the $1.9 billion nobody could find`,
      author: 'Elena Marsh',
      publishedAt: '2023-03-14',
      description: 'Three banks told investigators they had never held the escrow accounts.',
      provenance: {
        outlet: 'jsonld' as const,
        headline: 'jsonld' as const,
        author: 'jsonld' as const,
        publishedAt: 'jsonld' as const,
        description: 'og' as const,
      },
      archived: false,
    })
  },
}

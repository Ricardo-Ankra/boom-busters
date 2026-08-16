import type { SlotCandidate } from '@boom-busters/schemas'
import { falImageGen } from './fal'
import type {
  ImageGenProvider,
  ImageGenRequest,
  ImageGenResult,
  StockProvider,
  StockProviderId,
  StockQuery,
} from './types'

/**
 * Mock visual providers, on the house rules: deterministic for the same
 * input, self-contained (no network, no filesystem), and visibly fake — every
 * label says `[mock]` so a board full of these can never be mistaken for a
 * board that fetched something.
 *
 * Thumbnails are inline SVG data URLs rather than `mock://` references: the
 * board renders candidates in plain `<img>` tags, and a thumb that renders
 * with zero plumbing keeps the whole review flow testable in CI. The mock
 * image generator returns its "generated" frames the same way, which also
 * exercises the runner's rule that `data:` URLs are never downloaded to R2.
 */

/** Deterministic small positive number from a string, for colour variation. */
function tint(seed: string): number {
  let value = 0
  for (const char of seed) value = (value * 31 + char.charCodeAt(0)) % 360
  return value
}

function svgThumb(label: string, seed: string): string {
  const hue = tint(seed)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
    `<rect width="320" height="180" fill="hsl(${hue},18%,22%)"/>` +
    `<rect x="8" y="8" width="304" height="164" fill="none" stroke="hsl(${hue},30%,45%)" stroke-width="2"/>` +
    `<text x="160" y="95" font-family="monospace" font-size="14" fill="hsl(${hue},25%,80%)" text-anchor="middle">${label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .slice(0, 34)}</text>` +
    `</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

export function createMockStock(id: StockProviderId): StockProvider {
  return {
    id,
    requiresKey: false,

    async search(query: StockQuery): Promise<SlotCandidate[]> {
      const slug = query.query
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)

      return Array.from({ length: query.count }, (_, index) => {
        const isVideo = id !== 'wikimedia' && index % 2 === 1
        const label = `[mock] ${query.query} ${index + 1}`
        return {
          id: `mock-${id}-${slug}-${index + 1}`,
          provider: id,
          kind: isVideo ? ('video' as const) : ('image' as const),
          sourceUrl: `mock://${id}/${slug}/${index + 1}`,
          pageUrl: `https://example.com/${id}/${slug}/${index + 1}`,
          thumbUrl: svgThumb(label, `${id}:${slug}:${index}`),
          width: 1280,
          height: 720,
          ...(isVideo ? { durationMs: 8000 + index * 1000 } : {}),
          licence: '[mock] Free to use',
          attributionText: `[mock] nobody, via ${id}`,
          summary: `[mock] result ${index + 1} for "${query.query}". Nothing was fetched.`,
        }
      })
    },

    async verifyKey() {
      // A mock key is always fine.
    },
  }
}

export const mockImageGen: ImageGenProvider = {
  id: 'fal',
  // The LIVE price, same rule as the mock TTS and LLM adapters: budgets are
  // configuration that outlives a test run, and a mock that priced itself at
  // zero would make every cap hold or break for the wrong reason.
  pricePerImage: falImageGen.pricePerImage,

  async generate(request: ImageGenRequest): Promise<ImageGenResult> {
    return {
      images: Array.from({ length: request.count }, (_, index) => ({
        url: svgThumb(`[mock still ${index + 1}] ${request.prompt}`, `${request.prompt}:${index}`),
        width: 1344,
        height: 768,
      })),
      estimatedCostUsd: falImageGen.pricePerImage * request.count,
    }
  },

  async verifyKey() {
    // A mock key is always fine.
  },
}

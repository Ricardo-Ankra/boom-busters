import { Composition } from 'remotion'
import { loadFont as loadSourceSerif } from '@remotion/google-fonts/SourceSerif4'
import { loadBrandFonts } from '../fonts/load'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { FIXTURE_IMAGE_SKYLINE } from '../fixtures/media'
import {
  HeadlineClipping,
  HeadlineFullFrame,
  HeadlineStack,
  type HeadlineFacts,
} from './HeadlineCard'

/** THROWAWAY MOCK-UP root — renders the headline treatments for approval. */

const WIDE = { fps: 30, width: 1920, height: 1080, durationInFrames: 240 } as const
const TALL = { fps: 30, width: 1080, height: 1920, durationInFrames: 240 } as const

/**
 * Invented outlet, invented byline, invented headline. The real shot carries
 * the real ones, taken from the cited article.
 */
const FACTS: HeadlineFacts = {
  outlet: 'The Financial Record',
  headline: 'Auditors cannot find the $1.9 billion the company says it holds',
  emphasis: '$1.9 billion',
  deck: 'Three banks told investigators they had never held the escrow accounts named in the filings.',
  author: 'Elena Marsh',
  publishedAt: '14 March 2023',
  sourceDomain: 'financialrecord.example/2023/03/14',
}

const BEHIND = [
  { outlet: 'City Herald', headline: 'Board backs chief executive as shares fall 41%' },
  { outlet: 'The Daily Ledger', headline: 'Regulator opens inquiry into missing escrow' },
]

function Fonts({ children }: { children: React.ReactNode }) {
  loadSourceSerif('normal', { weights: ['400', '600', '700'], subsets: ['latin'] })
  loadBrandFonts(FIXTURE_BRAND.typography)
  return <>{children}</>
}

export function Root() {
  return (
    <>
      <Composition
        id="HeadlineClipping"
        component={() => (
          <Fonts>
            <HeadlineClipping facts={FACTS} brand={FIXTURE_BRAND} />
          </Fonts>
        )}
        {...WIDE}
      />
      <Composition
        id="HeadlineOverShot"
        component={() => (
          <Fonts>
            <HeadlineClipping
              facts={FACTS}
              brand={FIXTURE_BRAND}
              backdrop={FIXTURE_IMAGE_SKYLINE}
            />
          </Fonts>
        )}
        {...WIDE}
      />
      <Composition
        id="HeadlineFullFrame"
        component={() => (
          <Fonts>
            <HeadlineFullFrame facts={FACTS} brand={FIXTURE_BRAND} />
          </Fonts>
        )}
        {...WIDE}
      />
      <Composition
        id="HeadlineStack"
        component={() => (
          <Fonts>
            <HeadlineStack facts={FACTS} behind={BEHIND} brand={FIXTURE_BRAND} />
          </Fonts>
        )}
        {...WIDE}
      />
      <Composition
        id="HeadlineClippingTall"
        component={() => (
          <Fonts>
            <HeadlineClipping facts={FACTS} brand={FIXTURE_BRAND} />
          </Fonts>
        )}
        {...TALL}
      />
      <Composition
        id="HeadlineClippingMidSweep"
        component={() => (
          <Fonts>
            <HeadlineClipping facts={FACTS} brand={FIXTURE_BRAND} />
          </Fonts>
        )}
        {...WIDE}
      />
    </>
  )
}

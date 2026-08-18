import { useMemo } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import type { BrandKitTokens, Caption } from '@boom-busters/schemas'
import { captionSafeArea, pageAt, paginateCaptions } from '../lib/captions'
import { frameScale, typeStyle } from './brand'

/**
 * Karaoke captions (spec section 8.3): 1–3 words a page, the live word in
 * the Brand Kit's highlight colour, positioned inside the 9:16 safe zones
 * on portrait frames. Word TEXT is script ground truth, timings are from
 * alignment — the snap step upstream guarantees no mistranscription can
 * reach the screen. Mounted at the composition root, so times are absolute.
 */
export function KaraokeCaptions({ words, brand }: { words: Caption[]; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const pages = useMemo(() => paginateCaptions(words), [words])

  const tMs = (frame / fps) * 1000
  const page = pageAt(pages, tMs)
  if (!page) return null

  const safe = captionSafeArea(width, height)
  const scale = frameScale(width, height)
  const { colors, typography } = brand

  return (
    <div
      style={{
        position: 'absolute',
        left: width * safe.sideInsetFraction,
        right: width * safe.sideInsetFraction,
        bottom: height * (1 - safe.bottomFraction),
        textAlign: 'center',
        ...typeStyle(typography.captions, 52 * safe.fontScale, scale),
        lineHeight: 1.2,
        textShadow: '0 2px 18px rgba(0,0,0,0.85), 0 0 3px rgba(0,0,0,0.9)',
      }}
    >
      {page.words.map((word, index) => {
        const active = tMs >= word.startMs && tMs < word.endMs
        return (
          <span
            key={`${word.startMs}:${index}`}
            style={{ color: active ? colors.captionHighlight : colors.textPrimary }}
          >
            {index > 0 ? ' ' : ''}
            {word.text}
          </span>
        )
      })}
    </div>
  )
}

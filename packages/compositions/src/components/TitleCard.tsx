import type { BrandKitTokens } from '@boom-busters/schemas'
import { TitledCard } from './ChapterCard'

/**
 * The film's title card (spec section 6.3, decision 457): the compiler's
 * `titleCard` overlay, placed at the second chapter in `title` chapter
 * marking. It renders in the look's `chapterCardVariant` with the chapter
 * card's fades (FADE_MS = 700), through the same presentational function, so
 * the two can never drift apart.
 */
export function TitleCard({
  title,
  brand,
  durationInFrames,
}: {
  title: string
  brand: BrandKitTokens
  durationInFrames: number
}) {
  return <TitledCard title={title} brand={brand} durationInFrames={durationInFrames} />
}

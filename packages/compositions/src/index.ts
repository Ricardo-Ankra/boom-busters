/**
 * @boom-busters/compositions — the Remotion component library (build spec
 * section 8.3). Imports only from `@boom-busters/schemas`: a render must
 * never touch the DB. Two lighter subpath exports exist for the web app:
 * `./geo` (world geometry + projection, shared with the visual board's
 * MapPreview) and `./fonts` (the AVAILABLE_FONTS catalog the Brand Kit UI
 * reads) — neither pulls React or Remotion into a bundle.
 */

export { DocumentaryMaster } from './components/DocumentaryMaster'
export { KenBurnsImage } from './components/KenBurnsImage'
export { StockClip } from './components/StockClip'
export { ChartReveal } from './components/ChartReveal'
export type { ChartPayload } from './components/ChartReveal'
export { AnimatedMap } from './components/AnimatedMap'
export type { MapPayload } from './components/AnimatedMap'
export { LowerThird } from './components/LowerThird'
export { ChapterCard } from './components/ChapterCard'
export { KaraokeCaptions } from './components/KaraokeCaptions'
export { MusicBed } from './components/MusicBed'

export { AVAILABLE_FONTS, availableFont, assertBundledFamily } from './fonts/catalog'
export type { AvailableFont, FontRole } from './fonts/catalog'
export { loadBrandFonts } from './fonts/load'

export * from './geo'
export { paginateCaptions, pageAt, captionSafeArea } from './lib/captions'
export type { CaptionPage, CaptionSafeArea } from './lib/captions'
export {
  dbToGain,
  easeInOut,
  kenburnsScale,
  materialisedUrl,
  mediaUrl,
  msToFrames,
  transitionOpacity,
} from './lib/motion'

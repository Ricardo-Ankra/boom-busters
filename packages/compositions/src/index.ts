/**
 * @boom-busters/compositions — the Remotion component library (build spec
 * section 8.3). Imports only from `@boom-busters/schemas`: a render must
 * never touch the DB. One lighter subpath export exists for the web app:
 * `./geo` (world geometry + projection, shared with the visual board's
 * MapPreview), which pulls neither React nor Remotion into a bundle.
 * This barrel re-exports only what apps/web actually consumes; internal
 * files import each other relatively.
 */

export { DocumentaryMaster } from './components/DocumentaryMaster'
export { ChartReveal } from './components/ChartReveal'
export type { ChartPayload } from './components/ChartReveal'
export { AnimatedMap } from './components/AnimatedMap'
export { LowerThird } from './components/LowerThird'
export { ChapterCard } from './components/ChapterCard'
export { KaraokeCaptions } from './components/KaraokeCaptions'
export { MusicBed } from './components/MusicBed'

export { loadBrandFonts } from './fonts/load'

export * from './geo'
export { msToFrames } from './lib/motion'

import { Composition } from 'remotion'
import type { BrandKitTokens, GraphicPayload } from '@boom-busters/schemas'
import { GraphicCard } from '../../src/components/GraphicCard'
import { loadBrandFonts } from '../../src/fonts/load'
import { GRAPHIC_SCENE } from '../../src/fixtures/graphic'
import { FIXTURE_BRAND } from '../../src/fixtures/timeline'

/**
 * One composition for the live graphics harness: the real `GraphicCard`, at
 * whatever size and length the script asks for through its input props.
 *
 * `loadBrandFonts` is called the way `DocumentaryMaster` calls it (the card
 * does not load fonts itself; the master does, once per composition), so a
 * frame is set in the brand's real typefaces and not in whatever Chrome falls
 * back to.
 */

export type GraphicFrameProps = {
  payload: GraphicPayload
  brand: BrandKitTokens
  durationInFrames: number
  width: number
  height: number
}

const FPS = 30

function GraphicFrame({ payload, brand, durationInFrames }: GraphicFrameProps) {
  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)
  return <GraphicCard payload={payload} brand={brand} durationInFrames={durationInFrames} />
}

export function Root() {
  return (
    <Composition
      id="GraphicFrame"
      component={GraphicFrame}
      fps={FPS}
      width={1280}
      height={720}
      durationInFrames={FPS}
      // The real props always arrive as input props; the fixture only gives the
      // bundler and the Studio something to show.
      defaultProps={
        {
          payload: GRAPHIC_SCENE,
          brand: FIXTURE_BRAND,
          durationInFrames: FPS * 4,
          width: 1280,
          height: 720,
        } satisfies GraphicFrameProps
      }
      calculateMetadata={({ props }) => ({
        durationInFrames: props.durationInFrames,
        width: props.width,
        height: props.height,
      })}
    />
  )
}

import { registerRoot } from 'remotion'
import { Root } from './Root'

/**
 * The entry for `render-graphic-frames.ts` only. It is bundled by that script
 * alone: neither the Studio gallery (`src/Root.tsx`) nor the Remotion site
 * deployed to Lambda knows about it.
 */
registerRoot(Root)

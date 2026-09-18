import { loadFont as loadArchivo } from '@remotion/google-fonts/Archivo'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadSourceSerif } from '@remotion/google-fonts/SourceSerif4'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { assertBundledFamily } from './catalog'

/**
 * Font loading for compositions. Each loader pulls exactly the weights the
 * catalog bundles — the catalog is the contract, this file is the plumbing.
 * `loadFont` handles Remotion's delayRender internally, so callers just fire
 * this once per composition and await it where they need layout stability
 * (renderStill does, via waitUntilDone).
 */

const LOADERS: Record<string, () => { waitUntilDone: () => Promise<void> }> = {
  Inter: () =>
    loadInter('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] }),
  Archivo: () =>
    loadArchivo('normal', { weights: ['500', '600', '700', '800'], subsets: ['latin'] }),
  'JetBrains Mono': () =>
    loadJetBrainsMono('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }),
  'Source Serif 4': () =>
    loadSourceSerif('normal', { weights: ['400', '600', '700'], subsets: ['latin'] }),
}

/**
 * Load every family the brand's typography names. Throws synchronously on an
 * unbundled family; resolves when all faces are usable.
 */
export function loadBrandFonts(typography: BrandKitTokens['typography']): Promise<void> {
  // Always loaded, whatever the Brand Kit says: the headline card sets the
  // masthead and the headline in this serif rather than in a brand role
  // (decision 257), so no typography choice can announce that it is needed.
  const families = new Set<string>(['Source Serif 4'])
  for (const role of Object.values(typography)) {
    assertBundledFamily(role.family)
    families.add(role.family)
  }
  const loads = [...families].map((family) => {
    const loader = LOADERS[family]
    if (!loader) {
      // The catalog and LOADERS drifting apart is a build bug, not a data bug.
      throw new Error(`font "${family}" is in the catalog but has no loader`)
    }
    return loader().waitUntilDone()
  })
  return Promise.all(loads).then(() => undefined)
}

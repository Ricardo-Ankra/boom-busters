import { loadFont as loadArchivo } from '@remotion/google-fonts/Archivo'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadJetBrainsMono } from '@remotion/google-fonts/JetBrainsMono'
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
}

/**
 * Load every family the brand's typography names. Throws synchronously on an
 * unbundled family; resolves when all faces are usable.
 */
export function loadBrandFonts(typography: BrandKitTokens['typography']): Promise<void> {
  const families = new Set<string>()
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

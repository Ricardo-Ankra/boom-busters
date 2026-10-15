import type { Technique } from '@boom-busters/providers'
import type { CodeLogos } from '../projects/[id]/graphic-playback'

/**
 * The channel mark in the Exemplars tab (decision 305). The logo-reveal
 * example names its mark "Acme", the placeholder logo its checks ran with;
 * when the owner has set a channel mark, that mark plays under the same
 * title, so the tab shows the path a real mark takes through the design.
 * Every other example is handed no marks, as before. Plain functions, so the
 * page (on the server) and the tab (on the client) can both use them.
 */

/** The title the logo-reveal example reads its mark under: `EXEMPLAR_LOGO.title` in `lib/exemplar-translate.ts`. */
export const EXEMPLAR_LOGO_TITLE = 'Acme'

export type ExemplarLogo = CodeLogos[string]

interface LogoRow {
  id: string
  r2Key: string
  width: number | null
  height: number | null
  url: string | null
}

/**
 * The channel mark as the player takes it: the library mark stored under the
 * Brand Kit's key, when it has a URL to load and a recorded size to lay out
 * by; otherwise null.
 */
export function exemplarLogoFor(
  logos: readonly LogoRow[],
  channelMarkKey: string | null,
): ExemplarLogo | null {
  if (channelMarkKey === null) return null
  const mark = logos.find((logo) => logo.r2Key === channelMarkKey && logo.url !== null)
  if (!mark || mark.url === null || !mark.width || !mark.height) return null
  return { assetId: mark.id, url: mark.url, width: mark.width, height: mark.height }
}

/** The marks an example's player is handed: the channel mark for logo-reveal only. */
export function exemplarCodeLogos(technique: Technique, logo: ExemplarLogo | null): CodeLogos {
  return technique === 'logo-reveal' && logo !== null ? { [EXEMPLAR_LOGO_TITLE]: logo } : {}
}

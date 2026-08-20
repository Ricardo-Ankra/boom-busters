import { getRemotionEnvironment } from 'remotion'

/**
 * `crossOrigin` for every media element, in the @remotion/player only.
 *
 * In the browser, the player's media tags and the preview screen's buffer
 * button (a `fetch()`) share one HTTP cache. A media tag that loads without
 * an Origin header poisons that cache with responses carrying no CORS
 * headers, and every later `fetch()` of the same URL is answered from that
 * cache and blocked — which is why buffering failed for exactly the files
 * the player had already preloaded (found 2026-08-20). With `anonymous`,
 * both consumers make CORS requests and agree on the cached copy.
 *
 * Offline stays undefined: the render's Chromium fetches media without a
 * page origin, and the R2 bucket's CORS policy lists only the app's
 * origins — an `anonymous` request from the renderer would be refused.
 */
export function mediaCrossOrigin(): 'anonymous' | undefined {
  return getRemotionEnvironment().isPlayer ? 'anonymous' : undefined
}

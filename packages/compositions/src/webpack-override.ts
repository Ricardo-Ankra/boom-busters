import { webpack } from '@remotion/bundler'
import type { WebpackOverrideFn } from '@remotion/bundler'

/**
 * The schemas package hashes content with `node:crypto` (script/voice cache
 * keys). Compositions never call those functions, but the barrel import
 * drags the module into the browser bundle, which webpack refuses. Alias it
 * to an empty module: if a composition ever DID call createHash it would
 * fail loudly at runtime — which is correct, renders must not hash.
 *
 * Used by both the Studio (`remotion.config.ts`) and the snapshot tests'
 * `bundle()` call, so the two can never drift.
 */
export const webpackOverride: WebpackOverrideFn = (config) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    // `node:crypto` is a URL scheme webpack refuses to read; strip the
    // prefix so the request becomes plain `crypto` and falls through to the
    // fallback below.
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '')
    }),
  ],
  resolve: {
    ...config.resolve,
    fallback: {
      ...(config.resolve?.fallback ?? {}),
      crypto: false,
    },
  },
})

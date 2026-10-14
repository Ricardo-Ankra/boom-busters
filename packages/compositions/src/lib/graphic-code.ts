import * as React from 'react'
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { BrandKitTokens, GraphicCodePayload } from '@boom-busters/schemas'
import { mediaUrl } from './motion'
import {
  frozenEasing,
  graphicBrand,
  graphicFunctionBody,
  safeInsets,
  withAlpha,
} from './graphic-code-pure'
import type { GraphicComponent, GraphicProps, GraphicScope } from './graphic-code-pure'
import { motionTokens } from './motion-tokens'
import type { MotionTokens } from './motion-tokens'

/**
 * The Remotion-free half (props and scope types, `graphicFunctionBody`,
 * `frozenEasing`, `safeInsets`, `graphicBrand`, `withAlpha`) lives in
 * `graphic-code-pure.ts` and is re-exported here, so this file's names are
 * unchanged.
 */
export {
  frozenEasing,
  graphicBrand,
  graphicFunctionBody,
  safeInsets,
  withAlpha,
} from './graphic-code-pure'
export type { GraphicComponent, GraphicProps, GraphicScope } from './graphic-code-pure'

/**
 * The house motion tokens with the real `Easing` (decision 301), for house
 * code. A design never imports this: it reads the `motion` constant its own
 * compiled code declares (`MOTION_PREAMBLE`), which holds the same values.
 */
export const MOTION: MotionTokens = motionTokens(Easing)
export type { MotionTokens } from './motion-tokens'

/**
 * The sandbox the designer's graphic runs in (decision 295).
 *
 * The designer writes one React component, `function Graphic(props)`, with
 * helpers beside it. Its compiled code becomes the body of
 * `new Function('React', 'Remotion', 'props', body)`, with `return Graphic`
 * appended, so the code has no module scope: it reaches React, the nine names
 * in `GraphicScope` and its props, and nothing it could import around. The
 * static scan on the web server bans the globals (`window`, `fetch`, timers,
 * `Date`, `Math.random` and the rest) before code is ever stored; this file
 * is the other half, the arguments.
 *
 * One contract, three callers: `GraphicCode` here and on Lambda, the board's
 * player in the browser, and the dry run on the web server, which builds the
 * same body with `graphicFunctionBody` and a scope of plain functions.
 */

/** What `new Function` makes of the body: the declarations run, `Graphic` comes back. */
type SandboxFunction = (
  react: typeof React,
  remotion: GraphicScope,
  props: GraphicProps,
) => GraphicComponent

/**
 * Builds kept per scope, then per code. A film has a few dozen graphics and a
 * player mounts one at a time, so 32 per scope is plenty; the least recently
 * used build goes first.
 */
const BUILT_MAX = 32
const built = new WeakMap<GraphicScope, Map<string, GraphicComponent>>()

/**
 * new Function('React', 'Remotion', 'props', graphicFunctionBody(compiled)), bound to the scope.
 *
 * Parsed once per code and scope, so a component keeps one identity across
 * frames and React never remounts it. The outer function runs on every
 * render with that render's props and the `Graphic` it returns is called
 * directly, so the hooks inside belong to this component, and top-level
 * code reads the same props the dry run hands it. Code that does not parse
 * throws here; code that never declares `Graphic` throws at its first render.
 *
 * The dry run on the web server takes the equivalent path inside a `vm`
 * context: it compiles the same `graphicFunctionBody` as a function of
 * (React, Remotion, props), calls it with the props and renders the `Graphic`
 * it returns as a component. For a pure component the two paths draw the same
 * frames (ruling 15).
 */
export function buildGraphic(compiled: string, scope: GraphicScope): GraphicComponent {
  let byCode = built.get(scope)
  if (byCode === undefined) {
    byCode = new Map()
    built.set(scope, byCode)
  }
  const cached = byCode.get(compiled)
  if (cached !== undefined) {
    // Most recently used goes to the back, so the bound evicts the coldest.
    byCode.delete(compiled)
    byCode.set(compiled, cached)
    return cached
  }
  const sandbox = new Function(
    'React',
    'Remotion',
    'props',
    graphicFunctionBody(compiled),
  ) as SandboxFunction
  const component: GraphicComponent = (props) => sandbox(React, scope, props)(props)
  if (byCode.size >= BUILT_MAX) {
    const coldest = byCode.keys().next().value
    if (coldest !== undefined) byCode.delete(coldest)
  }
  byCode.set(compiled, component)
  return component
}

let liveScope: GraphicScope | undefined

/**
 * The real Remotion scope. One frozen object, shared: `buildGraphic` keys its
 * builds on the scope, and a graphic cannot reassign a name another graphic
 * reads. `Easing` is a frozen copy (`frozenEasing`), so its members cannot be
 * reassigned either; under the body's strict mode such an assignment throws.
 */
export function remotionScope(): GraphicScope {
  liveScope ??= Object.freeze({
    useCurrentFrame,
    useVideoConfig,
    interpolate,
    // Kept for designs stored before 2026-10-12; the prompt no longer offers it
    // and the web app's scan refuses it in a new design.
    spring,
    Easing: frozenEasing(Easing),
    Sequence,
    AbsoluteFill,
    Img,
    withAlpha,
  })
  return liveScope
}

/**
 * The props for one frame size: the brand as `graphicBrand` maps it, the
 * safe area as insets from each edge (`safeInsets`), the length the dry run
 * checked the code at (always `payload.durationMs`, ruling 7) and the logos
 * by entity as plain sources. A logo still carrying only a key throws, as
 * every composition does: a render reads materialised timelines only.
 */
export function graphicPropsFor(
  payload: GraphicCodePayload,
  brand: BrandKitTokens,
  frame: { width: number; height: number },
): GraphicProps {
  return {
    brand: graphicBrand(brand),
    words: payload.words,
    durationMs: payload.durationMs,
    safeArea: safeInsets(frame),
    logos: Object.fromEntries(
      Object.entries(payload.logos).map(([entity, ref]) => [
        entity,
        { src: mediaUrl(ref), width: ref.width, height: ref.height },
      ]),
    ),
    ...(payload.data !== undefined ? { data: payload.data } : {}),
  }
}

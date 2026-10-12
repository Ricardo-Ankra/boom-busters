import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Easing, interpolate, spring } from 'remotion'
import { describe, expect, it } from 'vitest'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import { withAlpha } from '../components/brand'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { safeArea } from './graphic'
import {
  buildGraphic,
  graphicBrand,
  graphicFunctionBody,
  graphicPropsFor,
  remotionScope,
  safeInsets,
  withAlpha as sandboxWithAlpha,
  type GraphicScope,
} from './graphic-code'

const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }

const PAYLOAD: GraphicCodePayload = {
  kind: 'graphic-code',
  version: 1,
  compiled: 'function Graphic() { return null }',
  title: 'Four billion, on paper',
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion.', atMs: 380 },
  ],
  durationMs: 6000,
  logos: {},
  claimIds: ['01HQ00000000000000000000AA'],
}

/** The real scope with the test's own clock: outside a composition the hook has no frame to read. */
function scopeAt(frame: number): GraphicScope {
  return { ...remotionScope(), useCurrentFrame: () => frame }
}

function render(compiled: string, scope: GraphicScope): string {
  const Graphic = buildGraphic(compiled, scope)
  return renderToStaticMarkup(createElement(Graphic, graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE)))
}

describe('graphicFunctionBody', () => {
  it('returns the component the source declares', () => {
    expect(graphicFunctionBody('function Graphic() {}')).toBe(
      'function Graphic() {}\nreturn Graphic',
    )
  })
})

describe('buildGraphic (decision 295)', () => {
  it('hands the code React, the Remotion scope and the props, and renders what it returns', () => {
    const compiled =
      "function Graphic(props) { return React.createElement('p', null, Remotion.useCurrentFrame() + '/' + props.durationMs + '/' + Remotion.withAlpha(props.brand.colors.accent, 0.5)) }"
    expect(render(compiled, scopeAt(42))).toBe(
      `<p>42/6000/${withAlpha(FIXTURE_BRAND.colors.accent, 0.5)}</p>`,
    )
  })

  it("runs helpers beside Graphic, and top-level code sees this render's props", () => {
    const compiled = [
      'function label(n) { return n + " ms" }',
      'const outer = props',
      "function Graphic(p) { return React.createElement('b', null, label(p.durationMs) + (outer === p ? ' same' : ' different')) }",
    ].join('\n')
    expect(render(compiled, scopeAt(0))).toBe('<b>6000 ms same</b>')
  })

  it('builds once per code and scope, and again for another scope', () => {
    const compiled = "function Graphic() { return React.createElement('i', null, 'x') }"
    const scope = scopeAt(0)
    expect(buildGraphic(compiled, scope)).toBe(buildGraphic(compiled, scope))
    expect(buildGraphic(compiled, scopeAt(0))).not.toBe(buildGraphic(compiled, scope))
  })

  it('keeps at most 32 builds per scope, dropping the least recently used', () => {
    const scope = scopeAt(0)
    const code = (n: number) =>
      `function Graphic() { return React.createElement('i', null, 'n${n}') }`
    const first = buildGraphic(code(0), scope)
    const second = buildGraphic(code(1), scope)
    for (let n = 2; n < 32; n += 1) buildGraphic(code(n), scope)
    // A hit moves the first build to the back of the queue.
    expect(buildGraphic(code(0), scope)).toBe(first)
    // The 33rd build evicts the coldest, which is now the second.
    buildGraphic(code(32), scope)
    expect(buildGraphic(code(1), scope)).not.toBe(second)
    expect(buildGraphic(code(0), scope)).toBe(first)
  })

  it('throws at build when the code does not parse', () => {
    expect(() => buildGraphic('function Graphic( {', scopeAt(0))).toThrow(SyntaxError)
  })

  it('throws at render, naming Graphic, when the code never declares it', () => {
    expect(() => render('function Chart() { return null }', scopeAt(0))).toThrow(/Graphic/)
  })
})

describe('remotionScope', () => {
  it('is exactly the nine names the sandbox promises, the real ones, frozen and shared', () => {
    const scope = remotionScope()
    expect(Object.keys(scope).sort()).toEqual(
      [
        'AbsoluteFill',
        'Easing',
        'Img',
        'Sequence',
        'interpolate',
        'spring',
        'useCurrentFrame',
        'useVideoConfig',
        'withAlpha',
      ].sort(),
    )
    expect(scope.interpolate).toBe(interpolate)
    expect(scope.spring).toBe(spring)
    expect(scope.Easing).toBe(Easing)
    expect(scope.withAlpha).toBe(withAlpha)
    // The subpath re-exports the same function, for the dry run and the still.
    expect(sandboxWithAlpha).toBe(withAlpha)
    expect(Object.isFrozen(scope)).toBe(true)
    expect(remotionScope()).toBe(scope)
  })
})

describe('safeInsets', () => {
  it("gives the code the graphic card's safe area as rounded insets from each edge", () => {
    expect(safeInsets(WIDE)).toEqual({ top: 36, right: 36, bottom: 270, left: 36 })
    expect(safeInsets(TALL)).toEqual({ top: 36, right: 36, bottom: 699, left: 36 })
    for (const frame of [WIDE, TALL]) {
      const box = safeArea(frame)
      expect(safeInsets(frame)).toEqual({
        top: Math.round(box.y),
        right: Math.round(frame.width - box.x - box.w),
        bottom: Math.round(frame.height - box.y - box.h),
        left: Math.round(box.x),
      })
    }
  })
})

describe('graphicBrand (ruling 26)', () => {
  it("passes the brand's colours and names its loaded font family for each type role", () => {
    const brand = graphicBrand(FIXTURE_BRAND)
    expect(brand.colors).toBe(FIXTURE_BRAND.colors)
    expect(brand.fonts).toEqual({
      heading: FIXTURE_BRAND.typography.heading.family,
      title: FIXTURE_BRAND.typography.title.family,
      body: FIXTURE_BRAND.typography.body.family,
      numbers: FIXTURE_BRAND.typography.numbers.family,
      captions: FIXTURE_BRAND.typography.captions.family,
    })
  })
})

describe('graphicPropsFor', () => {
  it('hands the code the brand as graphicBrand maps it', () => {
    expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE).brand).toEqual(graphicBrand(FIXTURE_BRAND))
  })

  it('hands the code safeInsets for each frame size', () => {
    for (const frame of [WIDE, TALL]) {
      expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, frame).safeArea).toEqual(safeInsets(frame))
    }
  })

  it('hands over the logos by entity as plain sources, the words, the length and any chart data', () => {
    const props = graphicPropsFor(
      {
        ...PAYLOAD,
        logos: {
          'Stability AI': {
            r2Key: 'boom-busters/logos/abc.png',
            url: 'https://example.com/abc.png',
            width: 1200,
            height: 400,
          },
        },
        data: {
          series: [
            {
              label: 'Valuation',
              unit: 'USD Millions',
              points: [
                { x: '2022', y: 1000 },
                { x: '2023', y: 4000 },
              ],
            },
          ],
          takeaway: 'Four times in a year.',
        },
      },
      FIXTURE_BRAND,
      WIDE,
    )
    expect(props.logos).toEqual({
      'Stability AI': { src: 'https://example.com/abc.png', width: 1200, height: 400 },
    })
    expect(props.words).toBe(PAYLOAD.words)
    expect(props.durationMs).toBe(6000)
    expect(props.data?.takeaway).toBe('Four times in a year.')
    expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE)).not.toHaveProperty('data')
  })

  it('refuses an unmaterialised logo, as every composition does', () => {
    const unsigned = {
      ...PAYLOAD,
      logos: { Acme: { r2Key: 'boom-busters/logos/acme.png', width: 10, height: 10 } },
    }
    expect(() => graphicPropsFor(unsigned, FIXTURE_BRAND, WIDE)).toThrow(/unmaterialised/)
  })
})

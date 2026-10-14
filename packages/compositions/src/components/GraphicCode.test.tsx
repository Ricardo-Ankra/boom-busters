// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { GraphicCodePayloadSchema } from '@boom-busters/schemas'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import { GRAPHIC_CODE_PAYLOAD, GRAPHIC_CODE_SOURCE } from '../fixtures/graphic-code'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { MOTION_PREAMBLE } from '../lib/motion-tokens'
import { GraphicCode } from './GraphicCode'

/**
 * `GraphicCode` mounted with React's client renderer in jsdom: the error
 * boundary is the thing under test, and React's server renderer never calls
 * a boundary. The two Remotion hooks are stubbed as in
 * DocumentaryMaster.test.tsx, so the frame and its size are the test's to
 * set; everything else the sandbox hands the code (interpolate, spring,
 * Easing) is Remotion's own.
 */
const clock = vi.hoisted(() => ({ frame: 0, width: 1920, height: 1080 }))

vi.mock('remotion', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useCurrentFrame: () => clock.frame,
    useVideoConfig: () => ({
      fps: 30,
      width: clock.width,
      height: clock.height,
      durationInFrames: 240,
    }),
  }
})
// A render loads the faces from Google Fonts; a test has no network and needs none.
vi.mock('../fonts/load', () => ({ loadBrandFonts: () => Promise.resolve() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

async function mount(element: ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(element)
  })
  return {
    text: () => host.textContent ?? '',
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next)
      })
    },
  }
}

let errors: MockInstance<typeof console.error>

beforeEach(() => {
  clock.frame = 0
  clock.width = 1920
  clock.height = 1080
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount()
    })
  }
  document.body.innerHTML = ''
  errors.mockRestore()
})

/** Our own reports, apart from the one React logs for every error a boundary catches. */
function reports(): string[] {
  return errors.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.startsWith('graphic-code:'))
}

function payload(overrides: Partial<GraphicCodePayload>): GraphicCodePayload {
  return { ...GRAPHIC_CODE_PAYLOAD, ...overrides }
}

describe('GraphicCode (decision 295)', () => {
  it('plays the fixture from its first frame: the title is there and the figure counts from nothing', async () => {
    const view = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(view.text()).toContain('Raised in one round')
    expect(view.text()).toContain('$0bn')
    expect(reports()).toEqual([])
  })

  it('holds its ending in both frames: the figure has landed and the second line is up', async () => {
    clock.frame = 240
    const wide = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(wide.text()).toContain('$4bn')
    expect(wide.text()).toContain('Then the next step')

    clock.width = 1080
    clock.height = 1920
    const tall = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(tall.text()).toContain('Raised in one round')
    expect(tall.text()).toContain('$4bn')
    expect(tall.text()).toContain('Then the next step')
    expect(reports()).toEqual([])
  })

  it('shows the title card when the code throws, and reports it once', async () => {
    const broken = payload({ compiled: 'function Graphic() { throw new Error("boom") }' })
    const view = await mount(<GraphicCode payload={broken} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(broken.title)

    clock.frame = 30
    await view.rerender(<GraphicCode payload={broken} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(broken.title)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain(broken.title)
  })

  it('shows the title card when the code does not parse', async () => {
    const view = await mount(
      <GraphicCode payload={payload({ compiled: 'function Graphic( {' })} brand={FIXTURE_BRAND} />,
    )
    expect(view.text()).toBe(GRAPHIC_CODE_PAYLOAD.title)
  })

  it('shows the title card for a sandbox version it does not know, without running the code', async () => {
    const future = payload({ version: 2, compiled: 'this is not code' })
    const view = await mount(<GraphicCode payload={future} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(future.title)
    await view.rerender(<GraphicCode payload={future} brand={FIXTURE_BRAND} />)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain('version 2')
  })
})

describe('the fixture graphic', () => {
  it('is a valid graphic-code payload', () => {
    const parsed = GraphicCodePayloadSchema.parse(JSON.parse(JSON.stringify(GRAPHIC_CODE_PAYLOAD)))
    expect(parsed).toEqual(GRAPHIC_CODE_PAYLOAD)
  })

  it('is plain JavaScript that declares Graphic in under 120 lines, with no colour of its own', () => {
    expect(GRAPHIC_CODE_SOURCE).toMatch(/^function Graphic\(props\) \{$/m)
    // No JSX, no hex colour, and nothing that would break the verbatim copy of providers' text.
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/[<#`\\]|\$\{/)
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/\b(rgb|rgba|hsl)\(/)
    expect(GRAPHIC_CODE_SOURCE.split('\n').length).toBeLessThan(120)
    expect(GRAPHIC_CODE_PAYLOAD.compiled).toBe(`${MOTION_PREAMBLE}\n${GRAPHIC_CODE_SOURCE}`)
    // On the tokens (decision 301): every curve and length a token, no Easing of its own.
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/\bEasing\b/)
    expect(GRAPHIC_CODE_SOURCE.match(/Remotion\.interpolate\(/g)).toHaveLength(4)
    expect(
      GRAPHIC_CODE_SOURCE.match(/easing: motion\.ease\.(enter|emphasis|linear)\b/g),
    ).toHaveLength(4)
  })
})

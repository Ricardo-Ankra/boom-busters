// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { CardCode } from '@boom-busters/schemas'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { CardOverlay } from './CardOverlay'

/** Stubbed clock, as in GraphicCode.test.tsx: the frame is the test's to set. */
const clock = vi.hoisted(() => ({ frame: 0 }))

vi.mock('remotion', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useCurrentFrame: () => clock.frame,
    useVideoConfig: () => ({ fps: 30, width: 1920, height: 1080, durationInFrames: 120 }),
  }
})
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
  return host
}

let errors: MockInstance<typeof console.error>

beforeEach(() => {
  clock.frame = 0
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

const WORDS_CODE: CardCode = {
  version: GRAPHIC_CODE_VERSION,
  compiled:
    "function Graphic(props) { return React.createElement('div', null, props.words.map(function (w) { return w.text }).join(' ')) }",
  title: 'The Card Title',
  words: [
    { text: 'one', atMs: 0 },
    { text: 'two', atMs: 400 },
  ],
  durationMs: 4000,
}

const THROWING_CODE: CardCode = {
  ...WORDS_CODE,
  compiled: 'function Graphic() { throw new Error("boom") }',
}

describe('CardOverlay', () => {
  it('renders an overlay without code as TitledCard', async () => {
    clock.frame = 60
    const host = await mount(
      <CardOverlay title="Plain Title" brand={FIXTURE_BRAND} durationInFrames={120} />,
    )
    expect(host.textContent).toBe('Plain Title')
  })

  it('renders card code through the sandbox', async () => {
    const host = await mount(
      <CardOverlay
        title="The Card Title"
        code={WORDS_CODE}
        brand={FIXTURE_BRAND}
        durationInFrames={120}
      />,
    )
    expect(host.textContent).toContain('one two')
  })

  it('falls back to TitledCard when card code throws', async () => {
    clock.frame = 60
    const host = await mount(
      <CardOverlay
        title="The Card Title"
        code={THROWING_CODE}
        brand={FIXTURE_BRAND}
        durationInFrames={120}
      />,
    )
    expect(host.textContent).toBe('The Card Title')
    // TitledCard's `full` variant draws an accent rule above the title; GraphicTitleCard does not.
    expect(host.innerHTML).toContain(`height: ${4 * (1080 / 1080)}px`)
  })

  it('fades a code card out over its last 700 ms', async () => {
    const element = (
      <CardOverlay
        title="The Card Title"
        code={WORDS_CODE}
        brand={FIXTURE_BRAND}
        durationInFrames={120}
      />
    )
    clock.frame = 60
    const mid = await mount(element)
    expect((mid.firstElementChild as HTMLElement).style.opacity).toBe('1')

    clock.frame = 119
    const end = await mount(element)
    expect(Number((end.firstElementChild as HTMLElement).style.opacity)).toBeLessThan(0.1)
  })
})

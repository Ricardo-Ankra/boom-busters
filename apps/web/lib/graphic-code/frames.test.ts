// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { compileGraphicSource } from './compile'
import { DRY_RUN_BRAND } from './check'
import { FRAME_SIZES } from './dry-run'
import {
  browserFrames,
  fontsHref,
  frameDocument,
  FramesUnavailable,
  layoutIssueIn,
  restMoments,
  screenshotDocument,
  shotMoments,
  type TextBox,
} from './frames'

const LANDSCAPE = FRAME_SIZES[0]
const box = (over: Partial<TextBox>): TextBox => ({
  node: 1,
  text: 'Revenue',
  x: 400,
  y: 400,
  width: 300,
  height: 60,
  fontPx: 72,
  opacity: 1,
  moving: false,
  ...over,
})

describe('restMoments (decision 389)', () => {
  it("reads each word once it has settled, or just before the next lands, and the slot's end", () => {
    const words = [{ atMs: 200 }, { atMs: 2000 }, { atMs: 2450 }]
    // 200 + 700; 2000 runs into 2450 - 60; 2450 + 700; the end.
    expect(restMoments(words, 6000)).toEqual([900, 2390, 3150, 5950])
  })

  it('merges moments closer than 400 ms into the later one', () => {
    // 240 (just before 300) merges into 540 (just before 600); then 1300 and the end.
    const words = [{ atMs: 0 }, { atMs: 300 }, { atMs: 600 }]
    expect(restMoments(words, 2000)).toEqual([540, 1300, 1950])
  })

  it('thins a long slot to ten moments, keeping the last', () => {
    const words = Array.from({ length: 30 }, (_, index) => ({ atMs: index * 1000 }))
    const moments = restMoments(words, 31_000)
    expect(moments).toHaveLength(10)
    expect(moments.at(-1)).toBe(30_950)
  })
})

describe('shotMoments (decision 389)', () => {
  it('takes up to six 16:9 moments, the last always, and the 9:16 middle and last', () => {
    const moments = [900, 2390, 3150, 4000, 4800, 5200, 5600, 5950]
    const shots = shotMoments(moments)
    expect(shots.landscape).toHaveLength(6)
    expect(shots.landscape.at(-1)).toBe(5950)
    expect(shots.portrait).toEqual([4000, 5950])
  })

  it('has nothing to photograph with no moments', () => {
    expect(shotMoments([])).toEqual({ landscape: [], portrait: [] })
  })
})

describe('layoutIssueIn (decision 389)', () => {
  it('passes text that sits apart, inside the safe area, large enough to read', () => {
    expect(
      layoutIssueIn([box({}), box({ node: 2, text: 'Loss', y: 520 })], LANDSCAPE, 2000),
    ).toBeNull()
  })

  it('refuses two runs of text that collide, naming them, the moment and the frame', () => {
    expect(layoutIssueIn([box({}), box({ node: 2, text: 'Loss', y: 420 })], LANDSCAPE, 2000)).toBe(
      'at 2.0 s in landscape, "Revenue" and "Loss" overlap; give each its own place, or let one leave before the other lands',
    )
  })

  it('reads only text at rest: faint or blurred text passing through is not a collision', () => {
    expect(
      layoutIssueIn(
        [box({}), box({ node: 2, text: 'Loss', y: 420, opacity: 0.3 })],
        LANDSCAPE,
        2000,
      ),
    ).toBeNull()
    expect(
      layoutIssueIn(
        [box({}), box({ node: 2, text: 'Loss', y: 420, moving: true })],
        LANDSCAPE,
        2000,
      ),
    ).toBeNull()
  })

  it('treats two copies of the same words in the same place as one run, and lines of one run as one', () => {
    expect(layoutIssueIn([box({}), box({ node: 2, x: 401 })], LANDSCAPE, 2000)).toBeNull()
    expect(layoutIssueIn([box({}), box({ y: 420 })], LANDSCAPE, 2000)).toBeNull()
  })

  it('refuses text past the safe area beyond the push slack, naming the edge', () => {
    expect(layoutIssueIn([box({ x: 1700, width: 300 })], LANDSCAPE, 1000)).toMatch(
      /^at 1\.0 s in landscape, "Revenue" runs \d+ px past the safe area at the right;/,
    )
    expect(layoutIssueIn([box({ x: 1920 - 96 - 300 + 20 })], LANDSCAPE, 1000)).toBeNull()
  })

  it('refuses type set too small to read on a phone, by its size, not its foreshortened box', () => {
    expect(layoutIssueIn([box({ fontPx: 20 })], LANDSCAPE, 1000)).toBe(
      'at 1.0 s in landscape, "Revenue" is set at 20 px, too small to read on a phone; set it at least 32 px',
    )
    // A large word turned away in 3D has a short box and its full size.
    expect(layoutIssueIn([box({ height: 18, fontPx: 150 })], LANDSCAPE, 1000)).toBeNull()
  })
})

describe('the page (decision 389)', () => {
  it("loads the brand's faces from Google Fonts at the catalogue's weights", () => {
    expect(fontsHref(DRY_RUN_BRAND.fonts)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=block',
    )
  })

  it("sets the frame's size, Remotion's reset and the brand background", () => {
    const page = frameDocument(LANDSCAPE, DRY_RUN_BRAND)
    expect(page).toContain('*{box-sizing:border-box}')
    expect(page).toContain(`background:${DRY_RUN_BRAND.colors.background}`)
    expect(page).toContain('#frame{position:relative;width:1920px;height:1080px')
  })
})

/** A design in the sandbox's terms, compiled and under the preamble, as one is stored. */
function stored(source: string): string {
  const compiled = compileGraphicSource(source)
  if (!compiled.ok) throw new Error(compiled.issue)
  return `${MOTION_PREAMBLE}\n${compiled.compiled}`
}

const twoLines = (gap: number) => `function Graphic(props) {
  const { width, height } = Remotion.useVideoConfig()
  const unit = Math.min(width, height) / 1080
  return (
    <Remotion.AbsoluteFill style={{ padding: props.safeArea.top + 'px ' + props.safeArea.right + 'px', justifyContent: 'center' }}>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Revenue</div>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, marginTop: ${gap} * unit, color: props.brand.colors.textPrimary }}>Loss</div>
    </Remotion.AbsoluteFill>
  )
}`

const props = {
  brand: DRY_RUN_BRAND,
  words: [
    { text: 'Revenue', atMs: 200 },
    { text: 'Loss', atMs: 1200 },
  ],
  durationMs: 3000,
  logos: {},
}

/** A browser is there to drive: Playwright's own download, or the path the host sets. */
async function browserAvailable(): Promise<boolean> {
  try {
    await browserFrames().inspect({
      compiled: stored(twoLines(40)),
      props,
      durationMs: 3000,
      shots: false,
    })
    return true
  } catch (error) {
    if (error instanceof FramesUnavailable) return false
    throw error
  }
}

describe.skipIf(!(await browserAvailable()))(
  'browserFrames in a real browser (decision 389)',
  () => {
    it('screenshots a document at the width asked', async () => {
      const jpeg = await screenshotDocument({
        html: '<html><body style="margin:0;width:1600px;height:300px;background:#123"></body></html>',
        width: 1600,
      })
      expect(jpeg.length).toBeGreaterThan(1000)
      // A JPEG's magic number.
      expect(jpeg[0]).toBe(0xff)
      expect(jpeg[1]).toBe(0xd8)
    }, 60_000)

    it('passes two lines set apart, and photographs the moments the review reads', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(twoLines(40)),
        props,
        durationMs: 3000,
        shots: true,
      })
      expect(result.layoutIssue).toBeNull()
      expect(result.shots.map((shot) => [shot.orientation, shot.atMs])).toEqual([
        ['landscape', 900],
        ['landscape', 1900],
        ['landscape', 2950],
        ['portrait', 1900],
        ['portrait', 2950],
      ])
      // A JPEG: the magic number, base64 encoded.
      expect(result.shots[0]!.jpeg.startsWith('/9j/')).toBe(true)
    }, 60_000)

    /** The second line pulled over the first, inside a wrapper styled `wrap`. */
    const overlapIn = (wrap: string) => `function Graphic(props) {
  const { width, height } = Remotion.useVideoConfig()
  const unit = Math.min(width, height) / 1080
  return (
    <Remotion.AbsoluteFill style={{ padding: props.safeArea.top + 'px ' + props.safeArea.right + 'px', justifyContent: 'center' }}>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Revenue</div>
      <div style={{ ${wrap} }}>
        <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, marginTop: -80 * unit, color: props.brand.colors.textPrimary }}>Loss</div>
      </div>
    </Remotion.AbsoluteFill>
  )
}`
    const inspectOverlap = (wrap: string) =>
      browserFrames().inspect({
        compiled: stored(overlapIn(wrap)),
        props,
        durationMs: 3000,
        shots: false,
      })

    it("does not count text an inset() clip-path hides, reading the page's own clip", async () => {
      expect((await inspectOverlap("clipPath: 'inset(0px 0px 100% 0px)'")).layoutIssue).toBeNull()
      expect((await inspectOverlap("clipPath: 'inset(-200px 0px 0px 0px)'")).layoutIssue).toMatch(
        /overlap/,
      )
    }, 60_000)

    it('reads text under a blur as moving, and blur(0px) as at rest', async () => {
      expect((await inspectOverlap("filter: 'blur(4px)'")).layoutIssue).toBeNull()
      expect((await inspectOverlap("filter: 'blur(0px)'")).layoutIssue).toMatch(/overlap/)
    }, 60_000)

    it("survives Vercel's single-process Chromium, which closes with its last page", async () => {
      vi.stubEnv('GRAPHIC_CHROMIUM_ARGS', '--single-process --no-zygote --no-sandbox')
      try {
        const result = await browserFrames().inspect({
          compiled: stored(twoLines(40)),
          props,
          durationMs: 3000,
          shots: true,
        })
        expect(result.layoutIssue).toBeNull()
        expect(result.shots.filter((shot) => shot.orientation === 'portrait')).toHaveLength(2)
      } finally {
        vi.unstubAllEnvs()
      }
    }, 60_000)

    it('gives up as unavailable, never hangs, when an inspection outlasts its time', async () => {
      await expect(
        browserFrames().inspect({
          compiled: stored(twoLines(40)),
          props,
          durationMs: 3000,
          shots: true,
          timeoutMs: 1,
        }),
      ).rejects.toThrow(/did not finish in/)
    }, 60_000)

    it('refuses two lines pulled over each other, by what the page measured', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(twoLines(-80)),
        props,
        durationMs: 3000,
        shots: false,
      })
      expect(result.layoutIssue).toMatch(/^at 0\.9 s in landscape, "Revenue" and "Loss" overlap;/)
    }, 60_000)
  },
)

// @vitest-environment node
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { compileGraphicSource } from './compile'
import { DRY_RUN_BRAND } from './check'
import { FRAME_SIZES } from './dry-run'
import {
  browserFrames,
  contrastFindingIn,
  contrastRatio,
  DENSE_SHOTS_MAX,
  denseMoments,
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
  color: 'rgb(255, 255, 255)',
  ground: null,
  ...over,
})

describe('denseMoments (spec 2026-11-04, section 10.2)', () => {
  it('samples every 250 ms on a short slot and thins a long one to 24', () => {
    expect(DENSE_SHOTS_MAX).toBe(24)
    expect(denseMoments(6000)).toHaveLength(23)
    expect(denseMoments(6000).slice(0, 3)).toEqual([250, 500, 750])
    expect(denseMoments(30000)).toHaveLength(23)
    expect(denseMoments(30000)[0]).toBe(1250)
    expect(denseMoments(500)).toEqual([250])
    expect(denseMoments(100)).toEqual([])
  })
})

describe('contrast (spec 2026-11-04, section 10.3)', () => {
  it('reads WCAG ratios from CSS colours and blends a translucent foreground', () => {
    expect(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)')).toBeCloseTo(21, 0)
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 0)
    expect(contrastRatio('rgba(255, 255, 255, 0.5)', 'rgb(0, 0, 0)')).toBeLessThan(6)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0)
    expect(contrastRatio('red', 'rgb(0, 0, 0)')).toBeNull()
    expect(contrastRatio('rgb(0, 0, 0)', 'rgba(0, 0, 0, 0)')).toBeNull()
  })

  it('finds a run under its bar by size, naming the run, the ratio and the bar', () => {
    const faint = box({
      text: 'Loss',
      fontPx: 40,
      color: 'rgb(90, 90, 90)',
      ground: 'rgb(20, 20, 20)',
    })
    expect(contrastFindingIn([faint], LANDSCAPE, 1600, '#000')).toMatch(
      /^at 1\.6 s in landscape, "Loss" reads at \d\.\d:1 on its ground; 3:1 is needed$/,
    )
    expect(contrastFindingIn([box({ ...faint, fontPx: 20 })], LANDSCAPE, 1600, '#000')).toMatch(
      /4\.5:1 is needed$/,
    )
    expect(
      contrastFindingIn([box({ ...faint, color: 'rgb(255, 255, 255)' })], LANDSCAPE, 1600, '#000'),
    ).toBeNull()
  })

  it('measures against the brand background when no ancestor paints one', () => {
    const bare = box({ text: 'Loss', fontPx: 40, color: 'rgb(30, 30, 30)', ground: null })
    expect(contrastFindingIn([bare], LANDSCAPE, 1600, '#101010')).toMatch(/reads at/)
    expect(contrastFindingIn([bare], LANDSCAPE, 1600, '#ffffff')).toBeNull()
  })

  it('skips text passing through: faint, blurred, or with a colour it cannot read', () => {
    const faint = box({
      text: 'Loss',
      fontPx: 40,
      color: 'rgb(30, 30, 30)',
      ground: 'rgb(0, 0, 0)',
    })
    expect(contrastFindingIn([box({ ...faint, opacity: 0.3 })], LANDSCAPE, 1600, '#000')).toBeNull()
    expect(contrastFindingIn([box({ ...faint, moving: true })], LANDSCAPE, 1600, '#000')).toBeNull()
    expect(
      contrastFindingIn([box({ ...faint, color: 'currentcolor' })], LANDSCAPE, 1600, '#000'),
    ).toBeNull()
  })
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

    it("takes the dense set and both sheets under Vercel's single-process Chromium, on one page (decision 447)", async () => {
      // A second page is a second browser context, and closing it took the
      // single-process browser down at the next frame size (the owner's run, 2026-11-09).
      vi.stubEnv('GRAPHIC_CHROMIUM_ARGS', '--single-process --no-zygote --no-sandbox')
      try {
        const result = await browserFrames().inspect({
          compiled: stored(twoLines(40)),
          props,
          durationMs: 3000,
          shots: true,
          dense: [250, 1250, 2250],
          sheets: true,
        })
        expect(result.dense).toHaveLength(6)
        expect(Object.keys(result.sheets).sort()).toEqual(['landscape', 'portrait'])
        for (const sheet of [result.sheets.landscape!, result.sheets.portrait!]) {
          expect((await sharp(Buffer.from(sheet, 'base64')).metadata()).width).toBe(1600)
        }
      } finally {
        vi.unstubAllEnvs()
      }
    }, 90_000)

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

    /** Two lines apart at rest; between 1.2 and 1.4 s the second sits over the first. */
    const crossing = () => `function Graphic(props) {
  const { width, height, fps } = Remotion.useVideoConfig()
  const t = (Remotion.useCurrentFrame() / fps) * 1000
  const unit = Math.min(width, height) / 1080
  const gap = t > 1200 && t < 1400 ? -80 : 40
  return (
    <Remotion.AbsoluteFill style={{ padding: props.safeArea.top + 'px ' + props.safeArea.right + 'px', justifyContent: 'center' }}>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Revenue</div>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, marginTop: gap * unit, color: props.brand.colors.textPrimary }}>Loss</div>
    </Remotion.AbsoluteFill>
  )
}`

    /** The second line on a painted card; the first bare on the brand background. */
    const carded = () => `function Graphic(props) {
  const { width, height } = Remotion.useVideoConfig()
  const unit = Math.min(width, height) / 1080
  return (
    <Remotion.AbsoluteFill style={{ padding: props.safeArea.top + 'px ' + props.safeArea.right + 'px', justifyContent: 'center' }}>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Revenue</div>
      <div style={{ background: 'rgb(20, 20, 20)', padding: 20 * unit, marginTop: 40 * unit }}>
        <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Loss</div>
      </div>
    </Remotion.AbsoluteFill>
  )
}`

    /** The second line in a grey too close to the brand background. */
    const dim = () => `function Graphic(props) {
  const { width, height } = Remotion.useVideoConfig()
  const unit = Math.min(width, height) / 1080
  return (
    <Remotion.AbsoluteFill style={{ padding: props.safeArea.top + 'px ' + props.safeArea.right + 'px', justifyContent: 'center' }}>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, color: props.brand.colors.textPrimary }}>Revenue</div>
      <div style={{ fontFamily: props.brand.fonts.heading, fontSize: 96 * unit, lineHeight: 1, marginTop: 40 * unit, color: 'rgb(60, 60, 60)' }}>Loss</div>
    </Remotion.AbsoluteFill>
  )
}`

    it('photographs the dense moments and returns a contact sheet per orientation (spec 10.2, 10.4)', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(twoLines(40)),
        props,
        durationMs: 3000,
        shots: true,
        dense: [250, 1250, 2250],
        sheets: true,
      })
      expect(result.layoutIssue).toBeNull()
      expect(result.findings).toEqual([])
      expect(result.dense.map((shot) => [shot.orientation, shot.atMs])).toEqual([
        ['landscape', 250],
        ['landscape', 1250],
        ['landscape', 2250],
        ['portrait', 250],
        ['portrait', 1250],
        ['portrait', 2250],
      ])
      expect(result.shots).toHaveLength(5)
      expect(Buffer.from(result.sheets.landscape!, 'base64')[0]).toBe(0xff)
      expect(Buffer.from(result.sheets.portrait!, 'base64')[1]).toBe(0xd8)
      // The sheet is 1600 px wide (spec 12.2), whatever scale the frames were shot at (final review, issue 2).
      const meta = await sharp(Buffer.from(result.sheets.landscape!, 'base64')).metadata()
      expect(meta.width).toBe(1600)
    }, 60_000)

    it("measures the rest moments in the review's mode, reporting a rest fault and contrast as findings (final review, issue 1)", async () => {
      const faulty = await browserFrames().inspect({
        compiled: stored(twoLines(-80)),
        props,
        durationMs: 3000,
        shots: true,
        measure: 'findings',
      })
      expect(faulty.layoutIssue).toBeNull()
      expect(faulty.shots).toHaveLength(5)
      expect(faulty.findings[0]).toMatch(/^at 0\.9 s in landscape, "Revenue" and "Loss" overlap/)

      const dimmed = await browserFrames().inspect({
        compiled: stored(dim()),
        props,
        durationMs: 3000,
        shots: false,
        measure: 'findings',
      })
      expect(dimmed.findings[0]).toMatch(/"Loss" reads at \d\.\d:1 on its ground; 3:1 is needed$/)
    }, 60_000)

    it('reports a collision in flight as a finding, not a refusal (spec 10.2)', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(crossing()),
        props,
        durationMs: 3000,
        shots: false,
        dense: [1250, 1300],
      })
      expect(result.layoutIssue).toBeNull()
      expect(result.findings[0]).toMatch(
        /^while moving, at 1\.[23] s in landscape, "Revenue" and "Loss" overlap/,
      )
      expect(result.dense).toHaveLength(4)
    }, 60_000)

    it("reads each run's colour and its painted ground, or none (spec 10.3)", async () => {
      const result = await browserFrames().inspect({
        compiled: stored(carded()),
        props,
        durationMs: 3000,
        shots: false,
      })
      expect(result.layoutIssue).toBeNull()
      expect(result.findings).toEqual([])
    }, 60_000)

    it('reports settled text under the contrast bar as a finding (spec 10.3)', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(dim()),
        props,
        durationMs: 3000,
        shots: false,
      })
      expect(result.layoutIssue).toBeNull()
      expect(result.findings[0]).toMatch(
        /^at 0\.9 s in landscape, "Loss" reads at \d\.\d:1 on its ground; 3:1 is needed$/,
      )
    }, 60_000)

    it('cuts the dense set short and says so when its time is spent', async () => {
      const result = await browserFrames().inspect({
        compiled: stored(twoLines(40)),
        props,
        durationMs: 3000,
        shots: true,
        dense: [250, 1250, 2250],
        sheets: true,
        denseMaxMs: 0,
      })
      // Both orientations' rest shots are taken before any dense work (final review, issue 3).
      expect(result.shots).toHaveLength(5)
      expect(result.dense).toEqual([])
      expect(result.sheets).toEqual({})
      expect(result.findings.at(-1)).toBe('the dense set was cut short at 0 of 6 shots')
    }, 60_000)
  },
)

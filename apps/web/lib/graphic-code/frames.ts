import { safeInsets } from '@boom-busters/compositions/graphic-code-pure'
import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import { GRAPHIC_TEXT_MIN_PX } from '@boom-busters/providers'
import type { Browser, Page } from 'playwright-core'
import { closeOrKill, hostFacts, launchMark } from './browser-process'
import {
  frameSizesFor,
  GRAPHIC_SAMPLE_MS,
  graphicMarkupAt,
  type FrameSize,
  type GraphicFrameSet,
} from './dry-run'
import { contrastRatio, fontsHref } from './page-pure'
import { SHEET_WIDTH, sheetDocument, type SheetTile } from './sheet-document'

export { contrastRatio, fontsHref }

/**
 * The designer's frames (decision 389): the code rendered in a real browser
 * at the moments a viewer reads it, so what the dry run cannot see (it has
 * markup, not layout) is measured: text that collides with other text, text
 * past the safe area, type too small to read on a phone. The same pages give
 * the review its pictures.
 *
 * The markup is the dry run's own (`graphicMarkupAt`, the same sandbox), set
 * in a page with the brand's faces loaded from Google Fonts, Remotion's
 * border-box reset and the brand background, at 1920 by 1080 and 1080 by
 * 1920. It measures and photographs; it never runs the model's code itself.
 *
 * Chromium comes from `@sparticuz/chromium` on Vercel and from Playwright's
 * own download elsewhere (the one the e2e suite installs), or from
 * `GRAPHIC_CHROMIUM_PATH`. Both packages are server externals in
 * `next.config.ts`, imported on first use, so the trace ships them and a host
 * without them fails here, as `FramesUnavailable`, rather than at load.
 */

/** One run of visible text at one moment, in CSS pixels of the full frame. */
export interface TextBox {
  /** Which text node it is: two boxes of one node are lines of the same run. */
  node: number
  text: string
  x: number
  y: number
  width: number
  height: number
  /** The type's size in frame pixels: its font size times its 2D scale, never its 3D foreshortening. */
  fontPx: number
  /** The product of every ancestor's opacity. */
  opacity: number
  /** Under a blur: moving, so not read as at rest. */
  moving: boolean
  /** The computed colour of the type, as the page reports it. */
  color: string
  /** The nearest ancestor's painted background, or null when none paints one (the brand background shows). */
  ground: string | null
}

export interface FrameShot {
  orientation: FrameSize['orientation']
  atMs: number
  /** A JPEG at half the frame's size, base64 with no data-URI prefix. */
  jpeg: string
}

export interface FramesInput {
  compiled: string
  props: Omit<GraphicProps, 'safeArea'>
  durationMs: number
  /** The frames the design plays in: both by default, the 9:16 alone for a Short's own (decision 476). */
  frames?: GraphicFrameSet
  /** Photograph the review's moments. */
  shots: boolean
  /**
   * Measure the layout at every rest moment; false photographs only; true
   * when not given. `'findings'` measures too, but a rest fault and a
   * contrast fault are findings for the critic, never a refusal, so a
   * design stored before the layout check is still reviewed whole.
   */
  measure?: boolean | 'findings'
  /** The longest the whole inspection may take; `INSPECT_MAX_MS` when not given. */
  timeoutMs?: number
  /**
   * Moments photographed through the moves (spec 2026-11-04, section 10.2),
   * measured in flight for findings and laid out on the contact sheet; none
   * when not given.
   */
  dense?: readonly number[]
  /** A contact sheet per orientation of its dense shots, taken in the same page. */
  sheets?: boolean
  /**
   * The longest the dense set and the sheets may take, counted from the end
   * of the rest moments; the time then left, less a margin, when not given.
   */
  denseMaxMs?: number
}

export interface FramesResult {
  /** Why the layout cannot be kept, naming the moment and the frame; null when it reads. */
  layoutIssue: string | null
  shots: FrameShot[]
  /**
   * What the critic is told, never a refusal: a collision in flight, settled
   * text under the contrast bar, and a dense set cut short, in time order.
   */
  findings: string[]
  dense: FrameShot[]
  /** The contact sheet of each orientation's dense shots, a JPEG in base64. */
  sheets: Partial<Record<FrameSize['orientation'], string>>
}

/** What the designer is handed: the real browser in the app, a stub in its tests. */
export interface GraphicFrames {
  inspect(input: FramesInput): Promise<FramesResult>
}

/** The browser could not be started or driven: the design keeps what the dry run found. */
export class FramesUnavailable extends Error {}

/**
 * The longest an inspection may take, launch included. A browser that dies
 * under Playwright can leave its promises unsettled rather than rejected (the
 * first redesign after decision 389's deploy ran into Vercel's 300 s limit so),
 * so every stage is raced against a clock and a stall becomes `FramesUnavailable`.
 */
export const INSPECT_MAX_MS = 45_000
const LAUNCH_MAX_MS = 20_000
const CLOSE_MAX_MS = 5_000
/** What the dense set leaves of the inspection's time for the result to be returned. */
const DENSE_MARGIN_MS = 5_000
/** A contact sheet is taken only with this much of the dense time left: its page, its fonts and a full-page shot. */
const SHEET_RESERVE_MS = 3_000

/** `work`, or `FramesUnavailable` naming `what` once `ms` have passed. */
function withinTime<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new FramesUnavailable(
            `the designer's frames: ${what} did not finish in ${Math.round(ms / 1000)} s`,
          ),
        ),
      ms,
    )
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

// ---------------------------------------------------------------------------
// The moments
// ---------------------------------------------------------------------------

/** How long after a word its entrance has settled. */
const SETTLE_MS = 700
/** Two moments closer than this read as one. */
const MOMENT_GAP_MS = 400
/** At most this many measured moments in each frame size. */
const MOMENTS_MAX = 10

/**
 * The moments a viewer reads the graphic at rest: each word's entrance once
 * it has settled, or just before the next word lands when that comes sooner,
 * and the last moment of the slot. Moments closer together than
 * `MOMENT_GAP_MS` merge into the later one, and a long slot is thinned evenly
 * to `MOMENTS_MAX`, keeping the last.
 */
export function restMoments(words: readonly { atMs: number }[], durationMs: number): number[] {
  const last = Math.max(0, durationMs - 50)
  const raw = words.map((word, index) => {
    const next = index + 1 < words.length ? words[index + 1]!.atMs : durationMs
    return Math.min(word.atMs + SETTLE_MS, next - 60)
  })
  const sorted = [...raw, last].filter((at) => at > 0 && at <= last).sort((a, b) => a - b)
  const merged: number[] = []
  for (const at of sorted) {
    if (merged.length > 0 && at - merged[merged.length - 1]! < MOMENT_GAP_MS) merged.pop()
    merged.push(Math.round(at))
  }
  if (merged.length <= MOMENTS_MAX) return merged
  const step = (merged.length - 1) / (MOMENTS_MAX - 1)
  return Array.from({ length: MOMENTS_MAX }, (_, index) => merged[Math.round(index * step)]!)
}

/**
 * The review's pictures: up to six moments of the film's 16:9 frame, evenly
 * across the rest moments and always the last, and the Short's 9:16 frame at
 * its middle moment and its last. A design made for one Short (decision 476)
 * plays only in 9:16, so its 9:16 frame takes the six.
 */
export function shotMoments(
  moments: readonly number[],
  frames: GraphicFrameSet = 'both',
): Record<FrameSize['orientation'], number[]> {
  const last = moments[moments.length - 1]
  if (last === undefined) return { landscape: [], portrait: [] }
  const wide =
    moments.length <= 6
      ? [...moments]
      : Array.from(
          { length: 6 },
          (_, index) => moments[Math.round((index * (moments.length - 1)) / 5)]!,
        )
  if (frames === 'portrait') return { landscape: [], portrait: [...new Set(wide)] }
  const middle = moments[Math.floor((moments.length - 1) / 2)]!
  return { landscape: [...new Set(wide)], portrait: [...new Set([middle, last])] }
}

/** At most this many dense shots per orientation (spec 2026-11-04, section 10.4). */
export const DENSE_SHOTS_MAX = 24

/**
 * The review's dense moments (spec 10.2): evenly across the slot, every
 * sample step on a short slot and thinned to the cap on a long one, from
 * one step in. The derivation passes its own moments around each
 * storyboard beat instead.
 */
export function denseMoments(durationMs: number): number[] {
  const step = Math.max(GRAPHIC_SAMPLE_MS, Math.ceil(durationMs / DENSE_SHOTS_MAX))
  const moments: number[] = []
  for (let at = step; at < durationMs && moments.length < DENSE_SHOTS_MAX; at += step) {
    moments.push(at)
  }
  return moments
}

// ---------------------------------------------------------------------------
// The layout rules
// ---------------------------------------------------------------------------

/** Text this faint, or under a blur, is passing through, not being read. */
const READ_OPACITY = 0.5
/** Two runs of text overlap when they share more than this share of the smaller one. */
const OVERLAP_SHARE = 0.2
/** How far into the safe area's margin a run may sit: the camera's slow push moves the edges a little. */
const EDGE_SLACK_PX = 24
/**
 * Type set smaller than this, in frame pixels, is too small to read on a
 * phone. The designer is told `GRAPHIC_TEXT_MIN_PX` (decision 472): the
 * floor it is asked for sits 6 px above the one it is refused at.
 */
const MIN_FONT_PX = GRAPHIC_TEXT_MIN_PX - 6

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const quoted = (text: string) => `"${text.length > 32 ? `${text.slice(0, 31)}…` : text}"`

/**
 * What a moment's measured text shows wrong, or null: two runs that collide,
 * a run past the safe area, or a run too small to read. Only text being read
 * counts (opaque enough and not under a blur); the lines of one run never
 * collide with each other, and two copies of the same words in the same place
 * (a colour change drawn as a crossfade) are one run.
 */
export function layoutIssueIn(
  boxes: readonly TextBox[],
  size: FrameSize,
  atMs: number,
): string | null {
  const where = `at ${seconds(atMs)} in ${size.orientation}`
  const read = boxes.filter((box) => box.opacity >= READ_OPACITY && !box.moving)
  for (const box of read) {
    if (box.fontPx < MIN_FONT_PX) {
      return `${where}, ${quoted(box.text)} is set at ${Math.round(box.fontPx)} px, too small to read on a phone; set it at least ${MIN_FONT_PX + 6} px`
    }
  }
  const insets = safeInsets(size)
  for (const box of read) {
    const past = [
      ['left', insets.left - box.x],
      ['top', insets.top - box.y],
      ['right', box.x + box.width - (size.width - insets.right)],
      ['bottom', box.y + box.height - (size.height - insets.bottom)],
    ] as const
    const edge = past.find(([, by]) => by > EDGE_SLACK_PX)
    if (edge) {
      return `${where}, ${quoted(box.text)} runs ${Math.round(edge[1])} px past the safe area at the ${edge[0]}; keep every word inside props.safeArea, the camera's push included`
    }
  }
  for (let i = 0; i < read.length; i += 1) {
    for (let j = i + 1; j < read.length; j += 1) {
      const a = read[i]!
      const b = read[j]!
      if (a.node === b.node) continue
      const sameRun = a.text === b.text && Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4
      if (sameRun) continue
      const shared =
        Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
      const smaller = Math.min(a.width * a.height, b.width * b.height)
      if (smaller > 0 && shared / smaller > OVERLAP_SHARE) {
        return `${where}, ${quoted(a.text)} and ${quoted(b.text)} overlap; give each its own place, or let one leave before the other lands`
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Contrast (spec 2026-11-04, section 10.3)
// ---------------------------------------------------------------------------

/** Type at or above this size needs 3:1; smaller type needs 4.5:1. */
export const CONTRAST_LARGE_PX = 24
export const CONTRAST_LARGE_MIN = 3
export const CONTRAST_SMALL_MIN = 4.5
/** At most this many findings per inspection, beyond the cut-short line. */
const FINDINGS_MAX = 8

/**
 * The first run of settled text under its contrast bar at this moment, as a
 * finding for the critic, or null. Measured against the nearest painted
 * ancestor, else the brand background behind the graphic. Only text being
 * read counts, as the layout rules count it.
 */
export function contrastFindingIn(
  boxes: readonly TextBox[],
  size: FrameSize,
  atMs: number,
  brandBackground: string,
): string | null {
  const read = boxes.filter((box) => box.opacity >= READ_OPACITY && !box.moving)
  for (const box of read) {
    const ratio = contrastRatio(box.color, box.ground ?? brandBackground)
    if (ratio === null) continue
    const needed = box.fontPx >= CONTRAST_LARGE_PX ? CONTRAST_LARGE_MIN : CONTRAST_SMALL_MIN
    if (ratio < needed) {
      return `at ${seconds(atMs)} in ${size.orientation}, ${quoted(box.text)} reads at ${ratio.toFixed(1)}:1 on its ground; ${needed}:1 is needed`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** A one-pixel transparent PNG: a logo's place without fetching the mark. */
const BLANK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** The page a moment's markup is set in: the frame's size, Remotion's reset, the brand's faces and background. */
export function frameDocument(size: FrameSize, brand: GraphicProps['brand']): string {
  const href = fontsHref(brand.fonts)
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    href ? `<link rel="stylesheet" href="${href}">` : '',
    '<style>*{box-sizing:border-box}html,body{margin:0;padding:0;overflow:hidden}',
    `body{width:${size.width}px;height:${size.height}px;background:${brand.colors.background}}`,
    `#frame{position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden}</style>`,
    '</head><body><div id="frame"></div></body></html>',
  ].join('')
}

/**
 * Runs in the page, as plain JavaScript text: every text node in the frame,
 * with the box of each line it occupies after the clipping of its ancestors
 * (overflow and an `inset()` clip-path), its effective opacity and whether it
 * sits under a blur. Text, not a function, because a function handed to the
 * page is serialised from the compiled module, and a compiler that keeps
 * names (esbuild's keepNames, under tsx) wraps it in a helper the page lacks.
 */
const MEASURE_IN_PAGE = `(() => {
  const frame = document.getElementById('frame')
  const boxes = []
  const px = (part, of) =>
    part === undefined ? 0 : part.endsWith('%') ? (parseFloat(part) / 100) * of : parseFloat(part) || 0
  const insetOf = (value, rect) => {
    const match = /^inset\\(([^)]*)\\)/.exec(value)
    if (!match) return null
    const parts = match[1].trim().split(/\\s+/).slice(0, 4)
    const top = px(parts[0], rect.height)
    const right = px(parts[1] ?? parts[0], rect.width)
    const bottom = px(parts[2] ?? parts[0], rect.height)
    const left = px(parts[3] ?? parts[1] ?? parts[0], rect.width)
    return { left: rect.left + left, top: rect.top + top, right: rect.right - right, bottom: rect.bottom - bottom }
  }
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  let node = 0
  while (walker.nextNode()) {
    const text = (walker.currentNode.textContent ?? '').trim()
    node += 1
    if (text === '') continue
    let opacity = 1
    let moving = false
    let hidden = false
    let ground = null
    const clips = []
    for (let element = walker.currentNode.parentElement; element && element !== frame; element = element.parentElement) {
      const style = getComputedStyle(element)
      opacity *= parseFloat(style.opacity) || 0
      if (ground === null && style.backgroundColor && style.backgroundColor !== 'transparent' && !/^rgba\\(\\d+, \\d+, \\d+, 0\\)$/.test(style.backgroundColor)) {
        ground = style.backgroundColor
      }
      if (style.visibility === 'hidden' || style.display === 'none') hidden = true
      if (/blur\\((?!0px\\))/.test(style.filter)) moving = true
      const rect = element.getBoundingClientRect()
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') clips.push(rect)
      if (style.clipPath && style.clipPath !== 'none') {
        const clip = insetOf(style.clipPath, rect)
        if (clip) clips.push(clip)
      }
    }
    if (hidden || opacity <= 0) continue
    const parent = walker.currentNode.parentElement
    const parentRect = parent.getBoundingClientRect()
    const scale = parent.offsetWidth > 0 ? parentRect.width / parent.offsetWidth : 1
    const fontPx = (parseFloat(getComputedStyle(parent).fontSize) || 0) * scale
    const color = getComputedStyle(parent).color
    const range = document.createRange()
    range.selectNodeContents(walker.currentNode)
    for (const line of Array.from(range.getClientRects())) {
      // A line box spans the font's whole ascent and descent, a fifth of it
      // above the capitals: the letters' own band is what can collide.
      let left = line.left
      let top = line.top + 0.2 * line.height
      let right = line.right
      let bottom = line.bottom - 0.1 * line.height
      for (const clip of clips) {
        left = Math.max(left, clip.left)
        top = Math.max(top, clip.top)
        right = Math.min(right, clip.right)
        bottom = Math.min(bottom, clip.bottom)
      }
      if (right - left > 1 && bottom - top > 1) {
        boxes.push({ node, text, x: left, y: top, width: right - left, height: bottom - top, fontPx, opacity, moving, color, ground })
      }
    }
  }
  return boxes
})()`

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

/** A package imported on first use; a host without it cannot inspect frames. */
async function loadModule<T>(name: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    throw new FramesUnavailable(
      `the designer's frames cannot load ${name} on this host: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** The switch each browser was launched under: how one that will not close is found (`browser-process.ts`). */
const launchMarks = new WeakMap<Browser, string>()

/** `(the browser was lost; ...)` with what the host can say, or nothing where it says nothing. */
function lostBrowserNote(): string {
  const facts = hostFacts()
  return facts === '' ? '' : ` (the browser was lost; ${facts})`
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await loadModule('playwright-core', () => import('playwright-core'))
  const own = process.env['GRAPHIC_CHROMIUM_PATH']
  const mark = launchMark()
  const launch = async (): Promise<Browser> => {
    if (own)
      return chromium.launch({
        executablePath: own,
        args: [mark],
        headless: true,
        timeout: LAUNCH_MAX_MS,
      })
    if (process.env['VERCEL'] || process.env['AWS_LAMBDA_FUNCTION_NAME']) {
      const packaged = await loadModule('@sparticuz/chromium', () => import('@sparticuz/chromium'))
      return chromium.launch({
        executablePath: await packaged.default.executablePath(),
        args: [...packaged.default.args, mark],
        headless: true,
        timeout: LAUNCH_MAX_MS,
      })
    }
    // GRAPHIC_CHROMIUM_ARGS adds flags to a local launch, so Vercel's
    // packaged browser (single-process, no zygote) can be reproduced here.
    const extra = (process.env['GRAPHIC_CHROMIUM_ARGS'] ?? '').split(' ').filter(Boolean)
    return chromium.launch({ headless: true, args: [...extra, mark], timeout: LAUNCH_MAX_MS })
  }
  try {
    const browser = await launch()
    launchMarks.set(browser, mark)
    return browser
  } catch (error) {
    throw new FramesUnavailable(
      `the designer's frames cannot start a browser:${error instanceof Error ? error.message : String(error)}${lostBrowserNote()}`,
    )
  }
}

/** Closes a browser, and kills one that will not close: it must not outlive its request. */
function closeBrowser(browser: Browser): Promise<void> {
  return closeOrKill(browser, launchMarks.get(browser), CLOSE_MAX_MS)
}

/**
 * A failure as `FramesUnavailable`, in `what`'s words. A browser that went
 * away mid-work says nothing of why, so the host's state goes into the words.
 */
function framesFailure(what: string, error: unknown, browser: Browser): FramesUnavailable {
  if (error instanceof FramesUnavailable) return error
  const message = (error instanceof Error ? error.message : String(error)).trimEnd()
  return new FramesUnavailable(
    `${what} failed: ${message}${browser.isConnected() ? '' : lostBrowserNote()}`,
  )
}

/** The swap of one moment's markup into the page, then a wait for its faces. */
async function showMoment(page: Page, markup: string): Promise<void> {
  const blanked = markup.replace(/src="mock:\/\/logo\/[^"]*"/g, `src="${BLANK_IMAGE}"`)
  // The faces get three seconds: a font that never arrives is measured in the fallback, not waited on.
  await page.evaluate(async (html) => {
    document.getElementById('frame')!.innerHTML = html
    await Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 3000))])
  }, blanked)
}

/**
 * The whole inspection, in two phases so the rest moments are never starved
 * (final review, issue 3). First, in each frame size, every rest moment
 * measured (a layout fault refuses, or is a finding in the review's mode; a
 * contrast fault is a finding) and the review's moments photographed. Then,
 * under a soft clock of `denseMaxMs` started once the rest moments are
 * done and never past `hardStop`, the dense moments of each frame size
 * measured in flight (a fault is a finding) and photographed, and the
 * frame size's contact sheet taken on a second page at full scale.
 */
async function inspectWith(
  browser: Browser,
  input: FramesInput,
  hardStop: number,
): Promise<FramesResult> {
  const moments = restMoments(input.props.words, input.durationMs)
  const sizes = frameSizesFor(input.frames)
  const wanted = input.shots ? shotMoments(moments, input.frames) : { landscape: [], portrait: [] }
  const measured = input.measure === false ? [] : moments
  const faultsAsFindings = input.measure === 'findings'
  const dense = [...new Set(input.dense ?? [])].sort((a, b) => a - b)
  const result: FramesResult = { layoutIssue: null, shots: [], findings: [], dense: [], sheets: {} }
  const findings: string[] = []
  let cutShort = false
  const note = (finding: string | null) => {
    if (finding !== null && findings.length < FINDINGS_MAX) findings.push(finding)
  }
  const done = () => {
    result.findings = [
      ...findings,
      ...(cutShort
        ? [
            `the dense set was cut short at ${result.dense.length} of ${dense.length * sizes.length} shots`,
          ]
        : []),
    ]
    return result
  }
  // One page for both frame sizes, resized between them. Vercel's packaged
  // Chromium runs as a single process, and closing its last page closes the
  // browser: a page per size lost the browser before the 9:16 frame.
  // Half the frame's pixels for the pictures; the measurements are in CSS pixels either way.
  const first = sizes[0]!
  const page = await browser.newPage({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: 0.5,
  })
  const rendered = new Map<
    FrameSize['orientation'],
    Map<number, { atMs: number; markup: string }>
  >()
  const showFrame = async (size: FrameSize) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.setContent(frameDocument(size, input.props.brand), {
      waitUntil: 'load',
      timeout: 15_000,
    })
  }

  // Phase one: the rest moments, in each frame size the design plays in.
  for (const size of sizes) {
    const rest = [...new Set([...measured, ...wanted[size.orientation]])].sort((a, b) => a - b)
    const markup = graphicMarkupAt(
      { compiled: input.compiled, props: input.props, durationMs: input.durationMs },
      size,
      [...new Set([...rest, ...dense])].sort((a, b) => a - b),
    )
    if (markup.issue !== null) return { ...done(), layoutIssue: markup.issue }
    const samples = new Map(markup.samples.map((sample) => [sample.atMs, sample]))
    rendered.set(size.orientation, samples)
    await showFrame(size)
    for (const atMs of rest) {
      const sample = samples.get(atMs)
      if (!sample) continue
      await showMoment(page, sample.markup)
      if (measured.includes(atMs)) {
        const boxes = (await page.evaluate(MEASURE_IN_PAGE)) as TextBox[]
        const issue = layoutIssueIn(boxes, size, atMs)
        if (issue !== null) {
          if (!faultsAsFindings) return { ...done(), layoutIssue: issue }
          note(issue)
        }
        note(contrastFindingIn(boxes, size, atMs, input.props.brand.colors.background))
      }
      if (wanted[size.orientation].includes(atMs)) {
        const jpeg = await page.screenshot({ type: 'jpeg', quality: 72 })
        result.shots.push({ orientation: size.orientation, atMs, jpeg: jpeg.toString('base64') })
      }
    }
  }
  if (dense.length === 0) return done()

  // Phase two: the dense moments and the sheets, on the soft clock.
  const denseStop = Math.min(
    Date.now() + (input.denseMaxMs ?? Infinity),
    hardStop - DENSE_MARGIN_MS,
  )
  for (const size of sizes) {
    const samples = rendered.get(size.orientation)!
    if (Date.now() >= denseStop) {
      cutShort = true
      break
    }
    await showFrame(size)
    const tiles: SheetTile[] = []
    for (const atMs of dense) {
      if (Date.now() >= denseStop) {
        cutShort = true
        break
      }
      const sample = samples.get(atMs)
      if (!sample) continue
      await showMoment(page, sample.markup)
      if (!measured.includes(atMs)) {
        const boxes = (await page.evaluate(MEASURE_IN_PAGE)) as TextBox[]
        const issue = layoutIssueIn(boxes, size, atMs)
        if (issue !== null) note(`while moving, ${issue}`)
      }
      const jpeg = (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64')
      result.dense.push({ orientation: size.orientation, atMs, jpeg })
      tiles.push({
        atMs,
        dataUri: `data:image/jpeg;base64,${jpeg}`,
        width: size.width / 2,
        height: size.height / 2,
      })
    }
    if (cutShort) break
    if (input.sheets && tiles.length > 0 && denseStop - Date.now() > SHEET_RESERVE_MS) {
      // On the frame page itself (decision 447): a second page is a second
      // browser context, and Vercel's single-process Chromium went down with
      // it at the next frame size. One pixel per CSS pixel keeps the sheet's
      // 1600 px (final review, issue 2) though the frames are shot at half
      // scale; the next frame size sets its own viewport and document.
      await page.setViewportSize({ width: SHEET_WIDTH, height: 800 })
      await page.setContent(sheetDocument(tiles), { waitUntil: 'load', timeout: 15_000 })
      const sheet = await page.screenshot({
        type: 'jpeg',
        quality: 80,
        fullPage: true,
        scale: 'css',
      })
      result.sheets[size.orientation] = sheet.toString('base64')
    }
  }
  return done()
}

/** The app's frames: one browser per inspection, closed after it. */
export function browserFrames(): GraphicFrames {
  return {
    async inspect(input) {
      const budget = input.timeoutMs ?? INSPECT_MAX_MS
      const started = Date.now()
      const launching = launchBrowser()
      const browser = await withinTime(
        launching,
        Math.min(budget, LAUNCH_MAX_MS),
        'the launch',
      ).catch((error: unknown) => {
        // A browser that starts after its launch was given up on closes itself.
        launching.then(closeBrowser).catch(() => undefined)
        throw error
      })
      try {
        const left = Math.max(1, budget - (Date.now() - started))
        return await withinTime(
          inspectWith(browser, input, Date.now() + left),
          left,
          'the inspection',
        )
      } catch (error) {
        throw framesFailure("the designer's frames", error, browser)
      } finally {
        await closeBrowser(browser)
      }
    },
  }
}

/**
 * One document photographed whole (spec 2026-11-04, section 7.3): the
 * reference sheets are laid out as a page and screenshotted here, on the
 * same browser and the same bounds as the inspection. The page is `width`
 * wide and as tall as the document; the picture is a JPEG.
 */
export async function screenshotDocument(input: {
  html: string
  width: number
  timeoutMs?: number
}): Promise<Buffer> {
  const budget = input.timeoutMs ?? INSPECT_MAX_MS
  const started = Date.now()
  const launching = launchBrowser()
  const browser = await withinTime(launching, Math.min(budget, LAUNCH_MAX_MS), 'the launch').catch(
    (error: unknown) => {
      launching.then(closeBrowser).catch(() => undefined)
      throw error
    },
  )
  try {
    const shoot = async () => {
      const page = await browser.newPage({
        viewport: { width: input.width, height: 800 },
        deviceScaleFactor: 1,
      })
      await page.setContent(input.html, { waitUntil: 'load', timeout: 15_000 })
      return page.screenshot({ type: 'jpeg', quality: 80, fullPage: true })
    }
    return await withinTime(shoot(), Math.max(1, budget - (Date.now() - started)), 'the sheet')
  } catch (error) {
    throw framesFailure('the sheet', error, browser)
  } finally {
    await closeBrowser(browser)
  }
}

/**
 * The thumbnail (spec 2026-11-25): one page at exactly `width` by `height`,
 * one pixel per CSS pixel, photographed as a JPEG with the text boxes the
 * in-page measure finds in `#frame`. The launch, the bounds and the
 * `FramesUnavailable` wrapping are `screenshotDocument`'s.
 */
export async function screenshotFrame(input: {
  html: string
  width: number
  height: number
  quality?: number
  timeoutMs?: number
}): Promise<{ jpeg: Buffer; boxes: TextBox[] }> {
  const budget = input.timeoutMs ?? INSPECT_MAX_MS
  const started = Date.now()
  const launching = launchBrowser()
  const browser = await withinTime(launching, Math.min(budget, LAUNCH_MAX_MS), 'the launch').catch(
    (error: unknown) => {
      launching.then(closeBrowser).catch(() => undefined)
      throw error
    },
  )
  try {
    const shoot = async () => {
      const page = await browser.newPage({
        viewport: { width: input.width, height: input.height },
        deviceScaleFactor: 1,
      })
      await page.setContent(input.html, { waitUntil: 'load', timeout: 15_000 })
      // The faces get three seconds: a font that never arrives is set in the fallback, not waited on.
      await page.evaluate(
        `Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 3000))])`,
      )
      const boxes = (await page.evaluate(MEASURE_IN_PAGE)) as TextBox[]
      const jpeg = await page.screenshot({
        type: 'jpeg',
        quality: input.quality ?? 90,
        fullPage: false,
      })
      return { jpeg, boxes }
    }
    return await withinTime(shoot(), Math.max(1, budget - (Date.now() - started)), 'the frame')
  } catch (error) {
    throw framesFailure('the frame', error, browser)
  } finally {
    await closeBrowser(browser)
  }
}

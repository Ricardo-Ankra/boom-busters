import vm from 'node:vm'
import { graphicFunctionBody, safeInsets } from '@boom-busters/compositions/graphic-code'
import type {
  GraphicComponent,
  GraphicProps,
  GraphicScope,
} from '@boom-busters/compositions/graphic-code'
import { GRAPHIC_STILL_MAX_MS } from '@boom-busters/schemas'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FrameContext, oneFrameScope } from './one-frame'

/**
 * The dry run (decision 295): the designer's compiled component rendered to
 * markup at every 250 ms of its slot, in the film's 16:9 frame and the
 * Short's 9:16, with Remotion's hooks shimmed. It finds what a machine can:
 * a crash, a frame too slow to render, dead air, an empty ending and an
 * element placed outside the safe area. Whether the graphic is any good is
 * the owner's call on the board.
 *
 * The code runs in a `vm` context of its own, so its globals are that
 * context's (no `require`, `process` or timers), and one call into the
 * context covers a whole frame size, so its timeout stops a loop that never
 * ends. `vm` is not a security boundary; the static scan and an honest
 * designer are.
 */

export const GRAPHIC_SAMPLE_MS = 250
export const GRAPHIC_FPS = 30
/** One frame's render may take this long. */
export const GRAPHIC_FRAME_MAX_MS = 2000
/** One frame size's whole run may take this long; the context's timeout stops it there. */
export const GRAPHIC_DRY_RUN_MAX_MS = 20_000
/** React writes rounded style values; an inset missed by less than this is not a crop. */
const SAFE_AREA_SLACK_PX = 1
/** An error message, cut to fit a refusal the model and the card both read. */
const MESSAGE_MAX = 200

export interface DryRunInput {
  compiled: string
  props: Omit<GraphicProps, 'safeArea'>
  durationMs: number
  /** One frame size's limit, `GRAPHIC_DRY_RUN_MAX_MS` by default; tests shorten it. */
  timeoutMs?: number
  /** One frame's limit, `GRAPHIC_FRAME_MAX_MS` by default; tests shorten it. */
  frameMaxMs?: number
}

export interface DryRunResult {
  issue: string | null
  /** Visible text per sample, landscape. */
  textSamples: string[]
}

const FRAME_SIZES = [
  { orientation: 'landscape', width: 1920, height: 1080 },
  { orientation: 'portrait', width: 1080, height: 1920 },
] as const
type FrameSize = (typeof FRAME_SIZES)[number]

type Sample = { atMs: number; markup: string }
type Run = { samples: Sample[]; failure: string | null }
type GraphicFactory = (react: typeof React, scope: GraphicScope, props: GraphicProps) => unknown
type Side = 'top' | 'right' | 'bottom' | 'left'
type Placement = { label: string; offsets: Partial<Record<Side, number>> }

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Every 250 ms from the slot's start, and its last moment. */
function sampleTimes(durationMs: number): number[] {
  const times: number[] = []
  for (let atMs = 0; atMs < durationMs; atMs += GRAPHIC_SAMPLE_MS) times.push(atMs)
  times.push(durationMs)
  return times
}

/** An error's message, whichever realm threw it, cut to fit a refusal. */
function messageOf(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message
}

const isTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&nbsp;': ' ',
}

/**
 * The words a sample shows: its markup without tags, entities decoded,
 * whitespace collapsed. Text at opacity 0 counts: a figure waiting to land
 * is checked against the claims as if it were on screen.
 */
export function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#x27|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const OFFSET = /(?:^|;)(top|right|bottom|left):(-?\d*\.?\d+(?:e[+-]?\d+)?)(px)?(?=;|$)/g
const FILLS_FRAME = /(?:^|;)inset:0(?:px)?(?=;|$)/

function offsetsOf(style: string): Placement['offsets'] {
  const offsets: Placement['offsets'] = {}
  for (const [, side, value, unit] of style.matchAll(OFFSET)) {
    if (side === undefined || value === undefined) continue
    const px = Number(value)
    // React writes a number as pixels and zero bare; a percentage is not read.
    if (unit === 'px' || px === 0) offsets[side as Side] = px
  }
  return offsets
}

function labelOf(inner: string, tag: string): string {
  const text = visibleText(inner)
  return text ? `"${text.slice(0, 40)}"` : `a ${tag} with no text`
}

/**
 * Every absolutely positioned element whose offsets are measured from the
 * frame, with its text. An element inside a positioned box that does not
 * fill the frame is measured from that box, so it is not read: a label at
 * the foot of its bar is not at the foot of the frame.
 */
export function framePlacements(markup: string): Placement[] {
  const placements: Placement[] = []
  const open: {
    tag: string
    textFrom: number
    childrenFromFrame: boolean
    offsets: Placement['offsets'] | null
  }[] = []
  for (const match of markup.matchAll(TAG)) {
    const [whole, closing, tag = '', attributes = '', selfClosing] = match
    if (closing) {
      const element = open.pop()
      if (element?.offsets) {
        placements.push({
          label: labelOf(markup.slice(element.textFrom, match.index), element.tag),
          offsets: element.offsets,
        })
      }
      continue
    }
    const fromFrame = open.at(-1)?.childrenFromFrame ?? true
    const style = /\sstyle="([^"]*)"/.exec(attributes)?.[1] ?? ''
    const position = /(?:^|;)position:(\w+)/.exec(style)?.[1] ?? 'static'
    const placed = position === 'absolute' || position === 'fixed'
    const offsets = placed && fromFrame ? offsetsOf(style) : null
    // A positioned box measures its children from itself; only a
    // full-frame layer measures them from the frame.
    const childrenFromFrame =
      position === 'static' ? fromFrame : placed && fromFrame && FILLS_FRAME.test(style)
    if (selfClosing || VOID_TAGS.has(tag.toLowerCase())) {
      if (offsets) placements.push({ label: labelOf('', tag), offsets })
      continue
    }
    open.push({ tag, textFrom: match.index + whole.length, childrenFromFrame, offsets })
  }
  return placements
}

function outsideInsets(offsets: Placement['offsets'], insets: GraphicProps['safeArea']): boolean {
  return (['top', 'right', 'bottom', 'left'] as const).some((side) => {
    const value = offsets[side]
    return value !== undefined && value < insets[side] - SAFE_AREA_SLACK_PX
  })
}

/** The longest run of consecutive samples with identical markup, by their times. */
function longestUnchanged(samples: readonly Sample[]): { fromMs: number; toMs: number } {
  let best = { fromMs: 0, toMs: 0 }
  let start = 0
  for (let at = 1; at <= samples.length; at += 1) {
    const first = samples[start]!
    if (at < samples.length && samples[at]!.markup === first.markup) continue
    const last = samples[at - 1]!
    if (last.atMs - first.atMs > best.toMs - best.fromMs) {
      best = { fromMs: first.atMs, toMs: last.atMs }
    }
    start = at
  }
  return best
}

/** What the samples of one frame size show wrong: dead air, an empty ending, a crop. */
function markupIssue(samples: readonly Sample[], size: FrameSize): string | null {
  const where = size.orientation === 'portrait' ? ' in portrait' : ''
  const still = longestUnchanged(samples)
  if (still.toMs - still.fromMs > GRAPHIC_STILL_MAX_MS) {
    return `nothing changes between ${seconds(still.fromMs)} and ${seconds(still.toMs)}${where}`
  }
  const last = samples.at(-1)
  if (last && visibleText(last.markup) === '') {
    return `the last second of the graphic is empty: hold the ending${where}`
  }
  const insets = safeInsets(size)
  for (const sample of samples) {
    const outside = framePlacements(sample.markup).find((placement) =>
      outsideInsets(placement.offsets, insets),
    )
    if (outside) return `${outside.label} sits outside the safe area in ${size.orientation}`
  }
  return null
}

function runFrameSize(
  input: DryRunInput,
  size: FrameSize,
): { issue: string | null; samples: Sample[] } {
  const durationInFrames = Math.max(1, Math.round((input.durationMs * GRAPHIC_FPS) / 1000))
  const props: GraphicProps = { ...input.props, safeArea: safeInsets(size) }
  const scope = oneFrameScope(size, durationInFrames, GRAPHIC_FPS)
  const frameMaxMs = input.frameMaxMs ?? GRAPHIC_FRAME_MAX_MS
  const timeoutMs = input.timeoutMs ?? GRAPHIC_DRY_RUN_MAX_MS

  const sandbox: Record<string, unknown> = {}
  const context = vm.createContext(sandbox)
  let factory: GraphicFactory
  try {
    const script = new vm.Script(
      `(function (React, Remotion, props) {\n${graphicFunctionBody(input.compiled)}\n})`,
      { filename: 'graphic.js' },
    )
    factory = script.runInContext(context) as GraphicFactory
  } catch (error) {
    return { issue: `the code does not run: ${messageOf(error)}`, samples: [] }
  }

  // Called from inside the context, so the context's timeout covers the
  // code's top level and every sample of this frame size.
  sandbox['__run'] = (): Run => {
    const samples: Sample[] = []
    let Graphic: unknown
    try {
      Graphic = factory(React, scope, props)
    } catch (error) {
      return { samples, failure: `the code does not run: ${messageOf(error)}` }
    }
    if (typeof Graphic !== 'function') {
      return { samples, failure: 'the code does not run: Graphic is not a function' }
    }
    for (const atMs of sampleTimes(input.durationMs)) {
      const frame = Math.min(durationInFrames - 1, Math.round((atMs * GRAPHIC_FPS) / 1000))
      const started = performance.now()
      let markup: string
      try {
        markup = renderToStaticMarkup(
          React.createElement(
            FrameContext.Provider,
            { value: frame },
            React.createElement(Graphic as GraphicComponent, props),
          ),
        )
      } catch (error) {
        return {
          samples,
          failure: `the code failed at ${seconds(atMs)} (frame ${frame}) in ${size.orientation}: ${messageOf(error)}`,
        }
      }
      if (performance.now() - started > frameMaxMs) {
        return {
          samples,
          failure: `frame ${frame} (${seconds(atMs)}) did not finish in ${frameMaxMs / 1000} s in ${size.orientation}`,
        }
      }
      samples.push({ atMs, markup })
    }
    return { samples, failure: null }
  }

  let run: Run
  try {
    run = vm.runInContext('__run()', context, { timeout: timeoutMs }) as Run
  } catch (error) {
    if (!isTimeout(error)) throw error
    return {
      issue: `the ${size.orientation} dry run did not finish in ${timeoutMs / 1000} s`,
      samples: [],
    }
  }
  if (run.failure !== null) return { issue: run.failure, samples: run.samples }
  return { issue: markupIssue(run.samples, size), samples: run.samples }
}

/** Landscape, then portrait; the first issue found stops the run. */
export function dryRunGraphic(input: DryRunInput): DryRunResult {
  let textSamples: string[] = []
  for (const size of FRAME_SIZES) {
    const { issue, samples } = runFrameSize(input, size)
    if (size.orientation === 'landscape') {
      textSamples = samples.map((sample) => visibleText(sample.markup))
    }
    if (issue !== null) return { issue, textSamples }
  }
  return { issue: null, textSamples }
}

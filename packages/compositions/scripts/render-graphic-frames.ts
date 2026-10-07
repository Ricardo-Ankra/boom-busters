import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, openBrowser, renderStill, selectComposition } from '@remotion/renderer'
import {
  BrandKitTokensSchema,
  GraphicSceneSchema,
  type BrandKitTokens,
  type GraphicPayload,
} from '@boom-busters/schemas'
import { GRAPHIC_SCENE } from '../src/fixtures/graphic'
import { FIXTURE_BRAND } from '../src/fixtures/timeline'
import { msToFrames } from '../src/lib/motion'
import { FPS, framesToRender } from './graphic-frames/frame-times'
import { webpackOverride } from '../src/webpack-override'

/**
 * Frames for the live graphics harness: turns a `live-graphic-runs/<run>/run.json`
 * (written by `pnpm live:graphic` in apps/web) into PNGs of what the designer
 * drew, rendered through the real `GraphicCard` in the brand's real fonts.
 *
 * Usage:  tsx scripts/render-graphic-frames.ts <run-dir>
 *         tsx scripts/render-graphic-frames.ts --fixture [out-dir]
 *
 * Per slot with an `after` (and its `before`, when the slot stored a scene), at
 * 1280x720 and 720x1280, a still at 0.3 s, at each element's entrance plus
 * 700 ms (the entrance has just finished), and at the last frame. Files are
 * `<slotIndex>-<after|before>-<landscape|portrait>-<ms>ms.png` in the run
 * folder, listed in `frames.json`.
 *
 * `--fixture` renders the Studio's own GRAPHIC_SCENE with the fixture brand
 * into a temp folder, with no run.json and no network call beyond the fonts:
 * the way to prove the renderer works without paying for a design.
 *
 * Its own Remotion entry (`graphic-frames/entry.ts`) is bundled here, once per
 * invocation; the Studio gallery and the deployed Remotion site do not carry it.
 */

function say(line: string): void {
  process.stdout.write(`${line}
`)
}

const here = path.dirname(fileURLToPath(import.meta.url))
const ORIENTATIONS = [
  { name: 'landscape', width: 1280, height: 720 },
  { name: 'portrait', width: 720, height: 1280 },
] as const

interface RunSlot {
  index: number
  slotId: string
  durationMs: number
  before?: unknown
  after?: unknown
  /** Logo element id to a presigned URL, for `after`. */
  logos?: Record<string, string>
  /** The same for `before`; falls back to `logos` when absent. */
  beforeLogos?: Record<string, string>
}

interface RunFile {
  brand?: unknown
  slots: RunSlot[]
}

interface FrameEntry {
  file: string
  slotIndex: number
  slotId: string
  side: 'after' | 'before'
  orientation: 'landscape' | 'portrait'
  frame: number
  ms: number
  width: number
  height: number
}

/** Logo ids to the `MediaRef` the card loads: the URL is all it reads. */
function logoRefs(urls: Record<string, string> | undefined): GraphicPayload['logos'] {
  return Object.fromEntries(
    Object.entries(urls ?? {}).map(([elementId, url]) => [
      elementId,
      { r2Key: 'live', url, width: 1, height: 1 },
    ]),
  )
}

async function renderRun(run: RunFile, outDir: string): Promise<FrameEntry[]> {
  if (!run.brand)
    throw new Error('run.json has no brand tokens; was the run stopped before it read them?')
  const brand: BrandKitTokens = BrandKitTokensSchema.parse(run.brand)

  mkdirSync(outDir, { recursive: true })
  await ensureBrowser()
  const serveUrl = await bundle({
    entryPoint: path.join(here, 'graphic-frames', 'entry.ts'),
    webpackOverride,
  })
  const browser = await openBrowser('chrome')
  const frames: FrameEntry[] = []
  try {
    for (const slot of run.slots) {
      const sides = [
        { side: 'after' as const, scene: slot.after, logos: slot.logos },
        { side: 'before' as const, scene: slot.before, logos: slot.beforeLogos ?? slot.logos },
      ]
      for (const { side, scene: stored, logos } of sides) {
        if (stored === undefined || stored === null) continue
        const scene = GraphicSceneSchema.parse(stored)
        const durationInFrames = Math.max(1, msToFrames(slot.durationMs, FPS))
        for (const orientation of ORIENTATIONS) {
          const inputProps = {
            payload: {
              kind: 'graphic',
              scene,
              logos: logoRefs(logos),
              claimIds: [],
            } satisfies GraphicPayload,
            brand,
            durationInFrames,
            width: orientation.width,
            height: orientation.height,
          }
          const composition = await selectComposition({
            serveUrl,
            id: 'GraphicFrame',
            inputProps,
            puppeteerInstance: browser,
          })
          for (const frame of framesToRender(scene, slot.durationMs)) {
            const ms = Math.round((frame * 1000) / FPS)
            const file = `${slot.index}-${side}-${orientation.name}-${ms}ms.png`
            await renderStill({
              composition,
              serveUrl,
              output: path.join(outDir, file),
              frame,
              inputProps,
              puppeteerInstance: browser,
            })
            frames.push({
              file,
              slotIndex: slot.index,
              slotId: slot.slotId,
              side,
              orientation: orientation.name,
              frame,
              ms,
              width: orientation.width,
              height: orientation.height,
            })
            say(file)
          }
        }
      }
    }
  } finally {
    await browser.close({ silent: true })
  }
  writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(frames, null, 2))
  return frames
}

/** The Studio's own scene, as a run of one slot with both sides, for the proof render. */
function fixtureRun(): RunFile {
  return {
    brand: FIXTURE_BRAND,
    slots: [
      {
        index: 0,
        slotId: 'fixture',
        durationMs: 4000,
        before: GRAPHIC_SCENE.scene,
        after: GRAPHIC_SCENE.scene,
        logos: Object.fromEntries(
          Object.entries(GRAPHIC_SCENE.logos).map(([id, ref]) => [id, ref.url ?? '']),
        ),
      },
    ],
  }
}

async function main(): Promise<void> {
  const [first, second] = process.argv.slice(2)
  if (!first) {
    throw new Error('usage: render-graphic-frames.ts <run-dir>  |  --fixture [out-dir]')
  }
  // `pnpm` runs scripts from the package folder; a relative path means "where I typed it".
  const invokedFrom = process.env['INIT_CWD'] ?? process.cwd()
  const resolve = (dir: string) => path.resolve(invokedFrom, dir)

  let run: RunFile
  let outDir: string
  if (first === '--fixture') {
    run = fixtureRun()
    outDir = second ? resolve(second) : mkdtempSync(path.join(tmpdir(), 'bb-graphic-fixture-'))
  } else {
    outDir = resolve(first)
    run = JSON.parse(readFileSync(path.join(outDir, 'run.json'), 'utf8')) as RunFile
  }

  const frames = await renderRun(run, outDir)
  say(`${frames.length} frames in ${outDir}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

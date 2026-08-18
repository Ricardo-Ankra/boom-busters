import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer'
import { TimelineSchema } from '@boom-busters/schemas'
import { renderFixtureTimeline } from '../src/fixtures/timeline'
import { webpackOverride } from '../src/webpack-override'

/**
 * The LOCAL render path (build spec section 13): `renderMedia` of a
 * materialised timeline on this machine, instead of Lambda. Two callers:
 *
 * - E2E / mock-provider mode, where the render-runner must produce a real
 *   master without AWS existing. CI renders the 20-second fixture through
 *   this exact script.
 * - A developer wanting a full master out of Studio fixtures.
 *
 * Usage:  tsx scripts/render-timeline.ts <timeline.json | --fixture> <out.mp4>
 *
 * Progress is written to stdout as single-line JSON events so a parent
 * process (the render-runner's local path) can mirror it into the renders
 * row the UI polls:  {"event":"progress","progress":0.42}
 *
 * Section 8.1 note: this local path COULD be made abortable with
 * `makeCancelSignal()` — Lambda renders cannot. Deliberately not built; the
 * spec says note it, not do it. A local render is bounded and free.
 */

const here = path.dirname(fileURLToPath(import.meta.url))

function emit(event: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

async function main(): Promise<void> {
  const [source, outPath] = process.argv.slice(2)
  if (!source || !outPath) {
    throw new Error('usage: render-timeline.ts <timeline.json | --fixture> <out.mp4>')
  }

  const timeline = TimelineSchema.parse(
    source === '--fixture'
      ? renderFixtureTimeline()
      : (JSON.parse(readFileSync(source, 'utf-8')) as unknown),
  )

  emit({ event: 'bundling' })
  await ensureBrowser()
  const serveUrl = await bundle({
    entryPoint: path.join(here, '..', 'src', 'studio.ts'),
    webpackOverride,
  })

  const inputProps = { timeline }
  const composition = await selectComposition({
    serveUrl,
    id: 'DocumentaryMaster',
    inputProps,
  })
  emit({
    event: 'rendering',
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
  })

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  let lastTenth = -1
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: path.resolve(outPath),
    inputProps,
    onProgress: ({ progress }) => {
      // One line per 10%, not per frame — the consumer is a DB column.
      const tenth = Math.floor(progress * 10)
      if (tenth > lastTenth) {
        lastTenth = tenth
        emit({ event: 'progress', progress: Math.round(progress * 100) / 100 })
      }
    },
  })

  emit({ event: 'done', output: path.resolve(outPath) })
}

main().catch((error: unknown) => {
  emit({ event: 'failed', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '../src/webpack-override'

/** THROWAWAY: renders the headline mock-ups to PNG and JPEG for review. */

const here = path.dirname(fileURLToPath(import.meta.url))

const CASES = [
  { id: 'HeadlineClipping', frame: 60 },
  { id: 'HeadlineOverShot', frame: 60 },
  { id: 'HeadlineFullFrame', frame: 60 },
  { id: 'HeadlineStack', frame: 75 },
  { id: 'HeadlineClippingTall', frame: 60 },
  { id: 'HeadlineClippingMidSweep', frame: 28 },
]

async function main(): Promise<void> {
  const outDir = process.argv[2]
  if (!outDir) throw new Error('usage: render-mockup.ts <outDir>')
  mkdirSync(outDir, { recursive: true })

  await ensureBrowser()
  const serveUrl = await bundle({
    entryPoint: path.join(here, '..', 'src', 'mockup', 'entry.ts'),
    webpackOverride,
  })

  for (const one of CASES) {
    const composition = await selectComposition({ serveUrl, id: one.id })
    await renderStill({
      composition,
      serveUrl,
      output: path.join(outDir, `${one.id}.png`),
      frame: one.frame,
      scale: 1,
    })
    await renderStill({
      composition,
      serveUrl,
      output: path.join(outDir, `${one.id}.jpeg`),
      frame: one.frame,
      scale: 0.667,
      imageFormat: 'jpeg',
      jpegQuality: 82,
    })
    process.stdout.write(`rendered ${one.id}\n`)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exit(1)
})

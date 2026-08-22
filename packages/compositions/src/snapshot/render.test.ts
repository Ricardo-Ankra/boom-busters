import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { webpackOverride } from '../webpack-override'

/**
 * Frame snapshots (build spec section 13): every fixture composition renders
 * one representative still through the real pipeline — webpack bundle,
 * headless Chrome — and is compared against a committed golden PNG.
 *
 * The compare is perceptual, not byte-exact: Chrome rasterises fonts
 * differently across platforms, so goldens regenerated on Windows must still
 * pass on Linux CI. pixelmatch with a small allowed differing-pixel ratio
 * absorbs antialiasing while still catching a missing map, a wrong colour or
 * an unstyled headline. Stills render at 0.25 scale to keep goldens small.
 *
 * Regenerate after an intentional visual change: REGEN_GOLDEN=1 pnpm test
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const goldenDir = path.join(here, 'golden')

interface SnapshotCase {
  id: string
  frame: number
  /** Text-heavy frames get more antialiasing headroom. */
  maxDiffRatio?: number
}

const CASES: SnapshotCase[] = [
  { id: 'KenBurnsImageFixture', frame: 75 },
  { id: 'ChartRevealLine', frame: 160, maxDiffRatio: 0.05 },
  { id: 'ChartRevealWaterfall', frame: 200, maxDiffRatio: 0.05 },
  { id: 'AnimatedMapFixture', frame: 200, maxDiffRatio: 0.05 },
  { id: 'LowerThirdBar', frame: 60, maxDiffRatio: 0.06 },
  { id: 'ChapterCardFull', frame: 40, maxDiffRatio: 0.06 },
  { id: 'KaraokeCaptionsWide', frame: 20, maxDiffRatio: 0.06 },
  { id: 'KaraokeCaptionsTall', frame: 20, maxDiffRatio: 0.06 },
  { id: 'DocumentaryMaster', frame: 200, maxDiffRatio: 0.06 },
  // Frame 190 ≈ 6.3 s: the clipped chart, a live caption word and the CTA
  // ending card all on screen at once — the Short's whole vocabulary.
  { id: 'ShortVertical', frame: 190, maxDiffRatio: 0.06 },
  { id: 'EndCtaFixture', frame: 60, maxDiffRatio: 0.06 },
]

let serveUrl: string
let outDir: string

beforeAll(async () => {
  await ensureBrowser()
  outDir = mkdtempSync(path.join(tmpdir(), 'bb-snapshots-'))
  serveUrl = await bundle({ entryPoint: path.join(here, '..', 'studio.ts'), webpackOverride })
}, 300_000)

describe('composition snapshots', () => {
  for (const snapshot of CASES) {
    it(`${snapshot.id} still matches its golden frame`, async () => {
      const composition = await selectComposition({ serveUrl, id: snapshot.id })
      const output = path.join(outDir, `${snapshot.id}.png`)
      await renderStill({
        composition,
        serveUrl,
        output,
        frame: snapshot.frame,
        scale: 0.25,
      })

      const goldenPath = path.join(goldenDir, `${snapshot.id}.png`)
      if (process.env['REGEN_GOLDEN'] === '1') {
        copyFileSync(output, goldenPath)
        return
      }

      expect(
        existsSync(goldenPath),
        `no golden for ${snapshot.id} — run REGEN_GOLDEN=1 pnpm test`,
      ).toBe(true)

      const actual = PNG.sync.read(readFileSync(output))
      const golden = PNG.sync.read(readFileSync(goldenPath))
      expect([actual.width, actual.height]).toEqual([golden.width, golden.height])

      const differing = pixelmatch(
        actual.data,
        golden.data,
        undefined,
        actual.width,
        actual.height,
        {
          threshold: 0.1,
        },
      )
      const ratio = differing / (actual.width * actual.height)
      expect(
        ratio,
        `${snapshot.id} differs from its golden by ${(ratio * 100).toFixed(2)}% of pixels`,
      ).toBeLessThanOrEqual(snapshot.maxDiffRatio ?? 0.03)
    })
  }
})

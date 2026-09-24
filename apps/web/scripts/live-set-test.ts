#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  findModel,
  geminiImageGen,
  google,
  HOUSE_PHOTOGRAPH,
  imageGenPrice,
  priceOf,
  stillStyleAnchors,
  stripBannedWords,
} from '@boom-busters/providers'
import type { ImageReference } from '@boom-busters/providers'
import {
  DEFAULT_SETTINGS,
  platesForCamera,
  SetCameraSchema,
  STILL_GENERATIONS,
} from '@boom-busters/schemas'
import type { SetCamera, SetPlate, SetPlateDirection, SetPlateView } from '@boom-busters/schemas'
import sharp from 'sharp'
import { z } from 'zod'
import { buildSetSheetPrompt, describeCamera } from '@/lib/set-plates'
import { splitContactSheet } from '@/lib/contact-sheet'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'
import { parseLiveSetArgs } from '@/lib/live-set-args'
import type { LiveSetArgs } from '@/lib/live-set-args'
import { layoutDraftRequest } from '@/lib/set-layout-prompt'
import { withReferenceClause } from '@/lib/still-prompt'

/**
 * The live set-to-shot harness (decision 275, Task 13): runs the real
 * set-to-shot path against Gemini outside the app — inventory draft, 4K
 * contact sheet, split, one still from a chosen camera — writing every
 * image, prompt and cost to a run folder for the controller to review, and
 * refusing any call that would take the run past its cap (default $1).
 *
 * Never part of `pnpm test` or `pnpm e2e`: it needs a real key and spends
 * money. It writes nothing to any database and does not record to the
 * app's cost ledger — `run.json` in the output folder is the record.
 */

const SHEET_MODEL = 'gemini-3-pro-image'
const SHOT_MODEL = 'gemini-3.1-flash-image'
/**
 * Reserved for the inventory draft before it runs, and recorded when the
 * adapter's own pricing helper cannot price it. A vision call on a Pro model
 * with thinking can pass a cent, so the reserve is generous.
 */
const INVENTORY_RESERVE_USD = 0.03
/** The harness makes one image per shot to stay under its cap; the app makes this many. */
const HARNESS_IMAGES_PER_SHOT = 1

const IMAGE_MIME_BY_EXT: Record<string, 'image/jpeg' | 'image/png' | 'image/webp'> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

const DEFAULT_SHOT = {
  prompt:
    'Two investors in dark suits argue across the table, one leaning forward with both hands ' +
    'flat on the wood, the other sitting back with arms folded.',
  camera: {
    facing: 'south',
    position: 'the north windows, seated eye height',
    lens: '35mm',
  },
} satisfies { prompt: string; camera: SetCamera }

const ShotFileSchema = z.object({
  prompt: z.string().min(1),
  camera: SetCameraSchema,
})

function mimeTypeFor(imagePath: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const ext = path.extname(imagePath).toLowerCase()
  const mime = IMAGE_MIME_BY_EXT[ext]
  if (!mime) {
    throw new Error(`${imagePath}: not a jpeg, png or webp file (extension "${ext}").`)
  }
  return mime
}

/** Decodes a Gemini `data:` URL into raw bytes. */
function decodeDataUrl(url: string): Buffer {
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

/** A folder-safe stamp: colons break directory names on Windows. */
function runStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main(): Promise<void> {
  // Argument parsing (and its `--cap` rules) is pure and file/network-free —
  // done before anything else touches a file, an env var or the network.
  let args: LiveSetArgs
  try {
    args = parseLiveSetArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // An unknown model would fail only after the key is read; refuse it first.
  if (!findModel(google, args.inventoryModel)) {
    console.error(
      `--inventory-model "${args.inventoryModel}" is not a Google model this app knows. Nothing was spent.`,
    )
    process.exit(1)
  }

  // Step 1 — never touch a file or make a call before this gate.
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY in .env.local (a Google AI Studio key). Nothing was spent.')
    process.exit(1)
  }

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const outDir = args.out ?? path.join(repoRoot, 'live-set-runs', runStamp())
  mkdirSync(outDir, { recursive: true })

  const budget = new LiveBudget(args.cap)
  const styleAnchors = args.anchors ?? stillStyleAnchors(DEFAULT_SETTINGS.brandKit)
  const prompts: { inventory?: string; sheet?: string; shot?: string } = {}
  const record: {
    name: string
    look: string
    image: string
    createdAt: string
    inventory?: { source: 'file' | 'generated'; path?: string; text: string; model?: string }
    shot?: { prompt: string; camera: SetCamera; platesUsed: SetPlateView[] }
    fidelity: {
      anchors: string
      anchorsSource: 'flag' | 'default Brand Kit'
      inventoryModel: string
      imagesPerShot: number
      appImagesPerShot: number
      note: string
    }
    error?: string
  } = {
    name: args.name,
    look: args.look,
    image: args.image,
    createdAt: new Date().toISOString(),
    // Where this run differs from what the app would do, so a reviewer reads
    // the output for what it is.
    fidelity: {
      anchors: styleAnchors,
      anchorsSource: args.anchors === undefined ? 'default Brand Kit' : 'flag',
      inventoryModel: args.inventoryModel,
      imagesPerShot: HARNESS_IMAGES_PER_SHOT,
      appImagesPerShot: STILL_GENERATIONS,
      note: `The harness makes ${HARNESS_IMAGES_PER_SHOT} image per shot; the app makes ${STILL_GENERATIONS}.`,
    },
  }

  const writeRunJson = (): void => {
    writeFileSync(
      path.join(outDir, 'run.json'),
      JSON.stringify(
        {
          ...record,
          prompts,
          budget: { capUsd: args.cap, entries: budget.entries, totalUsd: budget.spentUsd },
        },
        null,
        2,
      ),
    )
  }

  /**
   * Writes `run.json` with `message` recorded as why the run stopped, then
   * exits. A real `function` declaration, not a `const` arrow: only a named
   * function's `never` return type narrows the caller's control flow (e.g.
   * `panels` after `if (!panels) stopEarly(...)`), which a `const`-bound
   * arrow of the same type does not.
   */
  function stopEarly(message: string, code: number): never {
    record.error = message
    writeRunJson()
    console.error(message)
    process.exit(code)
  }

  try {
    // Step 2 — the set's first plate, facing north.
    const imageMime = mimeTypeFor(args.image)
    const imageBytes = readFileSync(args.image)
    const imageBase64 = imageBytes.toString('base64')
    const imageMeta = await sharp(imageBytes).metadata()
    if (!imageMeta.width || !imageMeta.height) {
      throw new Error(`${args.image}: could not read its dimensions.`)
    }

    // Read and validate --layout and --shot here, alongside --image, and
    // before any paid call (controller ruling: a bad shot.json must never
    // cost the $0.24 sheet, let alone the inventory call before it).
    const layoutFromFile = args.layout ? readFileSync(args.layout, 'utf8').trim() : null
    const shotInput = args.shot
      ? ShotFileSchema.parse(JSON.parse(readFileSync(args.shot, 'utf8')))
      : DEFAULT_SHOT

    // Step 3 — the inventory.
    let layout: string
    if (layoutFromFile !== null) {
      layout = layoutFromFile
      record.inventory = { source: 'file', path: args.layout, text: layout }
    } else {
      budget.reserve('inventory', INVENTORY_RESERVE_USD)
      const request = layoutDraftRequest({
        name: args.name,
        look: args.look,
        image: { mimeType: imageMime, data: imageBase64 },
      })
      const result = await google.complete(request, { apiKey, model: args.inventoryModel })
      // A reply cut off at its budget is a failed draft, as in the app: it
      // stops below as an empty inventory.
      layout = result.truncated ? '' : result.text.trim().slice(0, 1500)
      const model = findModel(google, args.inventoryModel)
      const actualUsd = model ? priceOf(model, result.usage) : INVENTORY_RESERVE_USD
      budget.record('inventory', actualUsd)
      prompts.inventory = request.messages[0]?.content
      record.inventory = { source: 'generated', text: layout, model: result.model }
    }

    // Ruling: an empty draft (e.g. a reply cut off) stops the run before the
    // $0.24 sheet, rather than sending Gemini a room description with
    // nothing in it.
    if (layout.trim() === '') {
      stopEarly('The inventory came back empty (the reply may have been cut off); see run.json.', 4)
    }

    // Step 4 — the contact sheet.
    const sheetPrompt = buildSetSheetPrompt({
      name: args.name,
      layout,
      look: args.look,
      styleAnchors,
    })
    prompts.sheet = sheetPrompt

    budget.reserve('sheet', imageGenPrice(geminiImageGen, 1, SHEET_MODEL, '4K'))
    const sheetResult = await geminiImageGen.generate(
      {
        prompt: sheetPrompt,
        count: 1,
        model: SHEET_MODEL,
        size: '4K',
        references: [
          {
            name: args.name,
            kind: 'object',
            facing: 'north',
            mimeType: imageMime,
            data: imageBase64,
          },
        ],
      },
      { apiKey },
    )
    budget.record('sheet', sheetResult.estimatedCostUsd)

    const sheetImage = sheetResult.images[0]
    if (!sheetImage) throw new Error('Gemini returned no sheet image.')
    const sheetBytes = decodeDataUrl(sheetImage.url)
    writeFileSync(path.join(outDir, 'sheet.png'), sheetBytes)

    const panels = await splitContactSheet(sheetBytes)
    if (!panels) {
      stopEarly('The sheet came back without clear borders; see sheet.png.', 2)
    }
    for (const panel of panels) {
      writeFileSync(path.join(outDir, `panel-${panel.direction}.png`), panel.bytes)
    }

    // Step 5 — the plates the shot may use: the original image as north, and
    // the east, south and west panels.
    const plateBytes = new Map<
      string,
      { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
    >()
    plateBytes.set('local/north', { mimeType: imageMime, data: imageBase64 })
    const setPlates: SetPlate[] = [
      {
        r2Key: 'local/north',
        contentHash: 'local-north',
        mimeType: imageMime,
        width: imageMeta.width,
        height: imageMeta.height,
        view: 'north',
        origin: 'uploaded',
      },
    ]
    const sidePanels = panels.filter(
      (panel): panel is typeof panel & { direction: Exclude<SetPlateDirection, 'north'> } =>
        panel.direction !== 'north',
    )
    for (const panel of sidePanels) {
      const key = `local/${panel.direction}`
      plateBytes.set(key, { mimeType: 'image/png', data: panel.bytes.toString('base64') })
      setPlates.push({
        r2Key: key,
        contentHash: `local-${panel.direction}`,
        mimeType: 'image/png',
        width: panel.width,
        height: panel.height,
        view: panel.direction,
        origin: 'generated',
      })
    }
    const set = { plates: setPlates }

    // Step 6 — the shot (prompt and camera already read and validated above).
    const chosen = platesForCamera(set, shotInput.camera.facing, 2)
    // The house line names no lens: the camera's reaches the model once, in
    // the camera sentence, exactly as in the app.
    const shotPrompt = withReferenceClause(
      stripBannedWords(`${shotInput.prompt} ${HOUSE_PHOTOGRAPH} ${styleAnchors}`),
      [],
      { name: args.name, plates: chosen.length },
      describeCamera(shotInput.camera, layout),
    )
    prompts.shot = shotPrompt
    record.shot = {
      prompt: shotInput.prompt,
      camera: shotInput.camera,
      platesUsed: chosen.map((plate) => plate.view),
    }

    const shotReferences: ImageReference[] = chosen.map((plate) => {
      const bytes = plateBytes.get(plate.r2Key)
      if (!bytes) throw new Error(`No bytes held locally for plate "${plate.r2Key}".`)
      return {
        name: args.name,
        kind: 'object',
        mimeType: bytes.mimeType,
        data: bytes.data,
        facing: plate.view as ImageReference['facing'],
      }
    })

    budget.reserve('shot', imageGenPrice(geminiImageGen, HARNESS_IMAGES_PER_SHOT, SHOT_MODEL, '1K'))
    const shotResult = await geminiImageGen.generate(
      {
        prompt: shotPrompt,
        count: HARNESS_IMAGES_PER_SHOT,
        model: SHOT_MODEL,
        size: '1K',
        references: shotReferences,
      },
      { apiKey },
    )
    budget.record('shot', shotResult.estimatedCostUsd)

    const shotImage = shotResult.images[0]
    if (!shotImage) throw new Error('Gemini returned no shot image.')
    writeFileSync(path.join(outDir, 'shot.png'), decodeDataUrl(shotImage.url))

    // Step 7.
    writeRunJson()
    console.log(outDir)
    console.log(`Total spent: $${budget.spentUsd.toFixed(4)}`)
  } catch (error) {
    if (error instanceof BudgetExceeded) {
      stopEarly(error.message, 3)
    }
    record.error = error instanceof Error ? error.message : String(error)
    writeRunJson()
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})

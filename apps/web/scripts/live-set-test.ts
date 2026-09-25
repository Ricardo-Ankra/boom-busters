#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  CastPhotoViewSchema,
  DEFAULT_SETTINGS,
  MAX_CAST_PHOTOS,
  MAX_CHARACTER_REFERENCES,
  MAX_SET_REFERENCES,
  platesForCamera,
  SetCameraSchema,
  ShotSizeSchema,
  spreadReferencePhotos,
  STILL_GENERATIONS,
} from '@boom-busters/schemas'
import type {
  CastPhoto,
  SetCamera,
  SetPlate,
  SetPlateDirection,
  SetPlateView,
} from '@boom-busters/schemas'
import sharp from 'sharp'
import { z } from 'zod'
import { buildSetSheetPrompt, describeCamera, framingLead, setPlateBrief } from '@/lib/set-plates'
import { splitContactSheet } from '@/lib/contact-sheet'
import type { SheetPanel } from '@/lib/contact-sheet'
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

const ShotFileSchema = z.object({
  prompt: z.string().min(1),
  camera: SetCameraSchema,
  /** The brief's shot size, which decides how much of the room the camera sentence shows. */
  shotSize: ShotSizeSchema.optional(),
  /**
   * The cast in the shot and their likeness photographs, paths relative to
   * the shot file. The prompt names them as the app's planner would; their
   * photographs are spent exactly as the app spends them.
   */
  cast: z
    .array(
      z.object({
        name: z.string().min(1),
        photos: z
          .array(z.object({ path: z.string().min(1), view: CastPhotoViewSchema.default('front') }))
          .min(1)
          .max(MAX_CAST_PHOTOS),
      }),
    )
    .optional(),
})
type ShotFile = z.infer<typeof ShotFileSchema>

const DEFAULT_SHOT: ShotFile = {
  prompt:
    'Two investors in dark suits argue across the table, one leaning forward with both hands ' +
    'flat on the wood, the other sitting back with arms folded.',
  camera: {
    facing: 'south',
    position: 'the north windows, seated eye height',
    lens: '35mm',
  },
}

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
  const prompts: { firstPlate?: string; inventory?: string; sheet?: string; shot?: string } = {}
  const record: {
    name: string
    look: string
    image: string
    createdAt: string
    firstPlate?: { prompt: string; model: string }
    inventory?: { source: 'file' | 'generated'; path?: string; text: string; model?: string }
    shot?: {
      prompt: string
      camera: SetCamera
      platesUsed: SetPlateView[]
      cast: { name: string; photos: number }[]
    }
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
    image: args.image ?? 'first-plate.png (generated)',
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
    // Read and validate --layout and --shot before any paid call (controller
    // ruling: a bad shot.json must never cost the $0.24 sheet, let alone the
    // calls before it).
    const layoutFromFile = args.layout ? readFileSync(args.layout, 'utf8').trim() : null
    const shotInput: ShotFile = args.shot
      ? ShotFileSchema.parse(JSON.parse(readFileSync(args.shot, 'utf8')))
      : DEFAULT_SHOT
    // The cast's photographs are read now too, so a missing file costs nothing.
    const castBytes = new Map<string, { mimeType: CastPhoto['mimeType']; data: string }>()
    const castMembers: { name: string; photos: CastPhoto[] }[] = []
    const shotDir = args.shot ? path.dirname(args.shot) : process.cwd()
    for (const member of shotInput.cast ?? []) {
      const photos: CastPhoto[] = []
      for (const [index, entry] of member.photos.entries()) {
        const file = path.resolve(shotDir, entry.path)
        const bytes = readFileSync(file)
        const meta = await sharp(bytes).metadata()
        if (!meta.width || !meta.height) throw new Error(`${file}: could not read its dimensions.`)
        const key = `local/cast/${member.name}/${index}`
        const mimeType = mimeTypeFor(file)
        castBytes.set(key, { mimeType, data: bytes.toString('base64') })
        photos.push({
          r2Key: key,
          contentHash: key,
          mimeType,
          width: meta.width,
          height: meta.height,
          view: entry.view,
        })
      }
      castMembers.push({ name: member.name, photos })
    }

    // Step 2 — the set's first plate, facing north: the given image, or one
    // drawn from the look exactly as the app's "Generate a plate" draws it
    // (the same brief, on the stills model at 1K), inside the cap.
    let imageMime: 'image/jpeg' | 'image/png' | 'image/webp'
    let imageBytes: Buffer
    // --from-run: the previous run's first plate, inventory and panels.
    const previous = args.fromRun
      ? (JSON.parse(readFileSync(path.join(args.fromRun, 'run.json'), 'utf8')) as {
          image?: string
          inventory?: { text?: string }
        })
      : null
    if (args.fromRun && previous) {
      const generated = path.join(args.fromRun, 'first-plate.png')
      const firstPath = existsSync(generated) ? generated : previous.image
      if (!firstPath || !existsSync(firstPath)) {
        throw new Error(`${args.fromRun}: no first plate to reuse.`)
      }
      imageMime = existsSync(generated) ? 'image/png' : mimeTypeFor(firstPath)
      imageBytes = readFileSync(firstPath)
    } else if (args.generateFirst) {
      const brief = setPlateBrief(
        { name: args.name, look: args.look, plates: [] },
        'north',
        styleAnchors,
      )
      const firstPrompt = stripBannedWords(brief.prompt)
      prompts.firstPlate = firstPrompt
      record.firstPlate = { prompt: firstPrompt, model: SHOT_MODEL }
      budget.reserve('first-plate', imageGenPrice(geminiImageGen, 1, SHOT_MODEL, '1K'))
      const firstResult = await geminiImageGen.generate(
        {
          prompt: firstPrompt,
          ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
          count: 1,
          model: SHOT_MODEL,
          size: '1K',
        },
        { apiKey },
      )
      budget.record('first-plate', firstResult.estimatedCostUsd)
      const firstImage = firstResult.images[0]
      if (!firstImage) throw new Error('Gemini returned no first plate.')
      imageBytes = decodeDataUrl(firstImage.url)
      const declared = firstImage.url.slice('data:'.length, firstImage.url.indexOf(';'))
      imageMime = declared === 'image/jpeg' || declared === 'image/webp' ? declared : 'image/png'
      writeFileSync(path.join(outDir, 'first-plate.png'), imageBytes)
    } else {
      const imagePath = args.image!
      imageMime = mimeTypeFor(imagePath)
      imageBytes = readFileSync(imagePath)
    }
    const imageBase64 = imageBytes.toString('base64')
    const imageMeta = await sharp(imageBytes).metadata()
    if (!imageMeta.width || !imageMeta.height) {
      throw new Error('The first plate: could not read its dimensions.')
    }

    // Step 3 — the inventory.
    let layout: string
    if (previous) {
      layout = previous.inventory?.text?.trim() ?? ''
      record.inventory = {
        source: 'file',
        path: path.join(args.fromRun!, 'run.json'),
        text: layout,
      }
    } else if (layoutFromFile !== null) {
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

    // Step 4 — the contact sheet, or the previous run's panels.
    let panels: SheetPanel[]
    if (args.fromRun) {
      panels = []
      for (const direction of ['north', 'east', 'south', 'west'] as const) {
        const file = path.join(args.fromRun, `panel-${direction}.png`)
        if (!existsSync(file))
          throw new Error(`${args.fromRun}: panel-${direction}.png is missing.`)
        const bytes = readFileSync(file)
        const meta = await sharp(bytes).metadata()
        panels.push({ direction, bytes, width: meta.width ?? 0, height: meta.height ?? 0 })
      }
    } else {
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

      const split = await splitContactSheet(sheetBytes)
      if (!split) {
        stopEarly('The sheet came back without clear borders; see sheet.png.', 2)
      }
      panels = split
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
    const sheetNorth = args.northFromSheet
      ? panels.find((panel) => panel.direction === 'north')
      : undefined
    if (args.northFromSheet && !sheetNorth) throw new Error('No north panel to use.')
    plateBytes.set(
      'local/north',
      sheetNorth
        ? { mimeType: 'image/png', data: sheetNorth.bytes.toString('base64') }
        : { mimeType: imageMime, data: imageBase64 },
    )
    const setPlates: SetPlate[] = [
      {
        r2Key: 'local/north',
        contentHash: 'local-north',
        mimeType: sheetNorth ? 'image/png' : imageMime,
        width: sheetNorth?.width ?? imageMeta.width,
        height: sheetNorth?.height ?? imageMeta.height,
        view: 'north',
        origin: sheetNorth ? 'generated' : 'uploaded',
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
    const chosen = platesForCamera(set, shotInput.camera.facing, MAX_SET_REFERENCES)
    const castPhotos = spreadReferencePhotos(castMembers, MAX_CHARACTER_REFERENCES)
    const people = [...new Set(castPhotos.map(({ member }) => member.name))].map((name) => ({
      name,
      photos: castPhotos.filter(({ member }) => member.name === name).length,
    }))
    // The house line names no lens: the camera's reaches the model once, in
    // the camera sentence, exactly as in the app.
    const shotPrompt = withReferenceClause(
      stripBannedWords(
        `${framingLead(shotInput.camera, shotInput.shotSize)}${shotInput.prompt} ${HOUSE_PHOTOGRAPH} ${styleAnchors}`,
      ),
      people,
      { name: args.name, plates: chosen.length },
      describeCamera(shotInput.camera, layout, shotInput.shotSize),
    )
    prompts.shot = shotPrompt
    record.shot = {
      prompt: shotInput.prompt,
      camera: shotInput.camera,
      platesUsed: chosen.map((plate) => plate.view),
      cast: people,
    }

    // People first, then the room, as the app sends them.
    const castReferences: ImageReference[] = castPhotos.map(({ member, photo }) => {
      const bytes = castBytes.get(photo.r2Key)
      if (!bytes) throw new Error(`No bytes held locally for photo "${photo.r2Key}".`)
      return { name: member.name, kind: 'character', mimeType: bytes.mimeType, data: bytes.data }
    })
    const plateReferences: ImageReference[] = chosen.map((plate) => {
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
        references: [...castReferences, ...plateReferences],
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

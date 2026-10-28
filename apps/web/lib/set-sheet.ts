import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  channelForProject,
  getWorkspace,
  upsertAssetByHash,
  visualCredentials,
} from '@boom-busters/db'
import { ValidationError } from '@boom-busters/schemas'
import type { ProjectSet, SetPlateDirection, SlotCandidate } from '@boom-busters/schemas'
import { imageGenModel, imageGenPrice, mockProvidersEnabled } from '@boom-busters/providers'
import type { ImageReference } from '@boom-busters/providers'
import { withCost } from '@boom-busters/cost'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { stillCatalogue, stillGenerator } from '@/lib/model-catalogue'
import { getObjectBytes, presignGet, putObject, stillKey } from '@/lib/storage'
import { mockContactSheet, splitContactSheet } from '@/lib/contact-sheet'
import { buildSetSheetPrompt } from '@/lib/set-plates'

/**
 * "Build the set" (decision 275): one contact sheet of the room from four
 * sides, on the `setSheet` route at 4K, with the set's north plate as the
 * reference, cut into four candidates the Set card offers like any other.
 *
 * On either still provider (decision 297). Gemini takes the plate inline and
 * draws at 4K; fal takes it as a presigned URL on the routed model's
 * reference endpoint (Kontext or flux-2/edit) and draws as large as that
 * endpoint allows, which is what is billed.
 */

export const UNSPLIT_SHEET =
  'The sheet came back without clear borders, so it was not split; build the set again.'

const PROVIDER_LABEL = { google: 'Gemini', fal: 'fal.ai' } as const

/**
 * An unsplit sheet still cost the owner $0.24, so it is kept where it can be
 * looked at and its key is logged. Best effort: a storage failure is logged
 * too and never changes the refusal the owner sees.
 */
async function keepUnsplitSheet(
  projectId: string,
  sheet: Buffer,
  contentType: string,
): Promise<void> {
  const contentHash = createHash('sha256').update(sheet).digest('hex')
  try {
    const { key } = await putObject(stillKey({ projectId, contentHash }), sheet, contentType)
    console.error(`The set sheet could not be split; it is stored unsplit at ${key}`)
  } catch (error) {
    console.error('The set sheet could not be split, and storing it failed:', error)
  }
}

/**
 * The generated sheet's bytes. Gemini hands them over inline as a data: URL;
 * fal hands over an expiring URL that must be fetched at once.
 */
async function sheetBytes(url: string): Promise<{ sheet: Buffer; sheetType: string }> {
  if (url.startsWith('data:')) {
    return {
      sheet: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
      sheetType: /^data:([^;,]+)/.exec(url)?.[1] ?? 'image/png',
    }
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new ValidationError(`The set sheet could not be fetched (${response.status}).`)
  }
  return {
    sheet: Buffer.from(await response.arrayBuffer()),
    sheetType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png',
  }
}

export async function buildSetSheet(
  set: ProjectSet,
): Promise<{ candidates: SlotCandidate[]; views: SetPlateDirection[] }> {
  const { settings } = await channelForProject(db, set.projectId)
  const route = settings.modelRouting.setSheet
  const provider = route.provider
  const catalogue = await stillCatalogue({
    routing: settings.modelRouting,
    prices: (await getWorkspace(db)).settings.modelPrices,
  })
  const live = catalogue[provider]
  // buildSetSheetPrompt runs the prompt through stripBannedWords itself now
  // (decision 287 final review), so the harness that calls it directly gets
  // the same text this action sends.
  const prompt = buildSetSheetPrompt({ name: set.name, layout: set.layout, look: set.look })
  const mocked = mockProvidersEnabled()
  // The endpoint that is actually billed: on fal the plate leaves the routed
  // model for its reference endpoint; Gemini takes it inline on the same model.
  const billed = live.referenceRoute?.(route.model, 1) ?? null

  let sheet: Buffer
  let sheetType = 'image/png'
  if (mocked) {
    sheet = await mockContactSheet()
  } else {
    const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    const apiKey = keys[provider]
    if (!apiKey) {
      throw new ValidationError(
        `Set sheets run on ${PROVIDER_LABEL[provider]}, but no ${PROVIDER_LABEL[provider]} key ` +
          'is stored in Settings → Connections.',
        { field: 'modelRouting.setSheet' },
      )
    }
    // Reference image 1 (decision 275, spec 5.1): the set's own north plate
    // when it has one, else whichever plate it holds first — never a plate
    // `platesForCamera` picked for its adjacency to a direction that is not
    // the one the prompt is about to claim it shows.
    const plate = set.plates.find((candidate) => candidate.view === 'north') ?? set.plates[0]
    if (!plate) throw new ValidationError('Add a plate first, then build the set from it.')
    const object = await getObjectBytes(plate.r2Key)
    const reference: ImageReference = {
      name: set.name,
      kind: 'object',
      // The plate's own view, never a hard-coded 'north': `facing` takes no
      // 'other', so an undirected plate sends none.
      ...(plate.view === 'other' ? {} : { facing: plate.view }),
      mimeType: plate.mimeType,
      data: Buffer.from(object.bytes).toString('base64'),
    }
    // fal's reference endpoints want a URL, not bytes (decision 253).
    const referenceUrls = provider === 'fal' ? [await presignGet(plate.r2Key)] : []
    const adapter = stillGenerator(provider, catalogue)
    const result = await withCost(
      db,
      {
        provider,
        operation: 'image.generate',
        projectId: set.projectId,
        estimateUsd: billed ? billed.pricePerImage : imageGenPrice(live, 1, route.model, '4K'),
        meta: {
          model: billed ? billed.id : route.model,
          set: set.name,
          kind: 'set-sheet',
          prompt: prompt.slice(0, 200),
        },
      },
      async () => {
        const generated = await adapter.generate(
          {
            prompt,
            count: 1,
            model: route.model,
            size: '4K',
            references: [reference],
            ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
          },
          { apiKey },
        )
        return { result: generated, actualUsd: generated.estimatedCostUsd }
      },
    )
    ;({ sheet, sheetType } = await sheetBytes(result.images[0]!.url))
  }

  const panels = await splitContactSheet(sheet)
  if (!panels) {
    await keepUnsplitSheet(set.projectId, sheet, sheetType)
    throw new ValidationError(UNSPLIT_SHEET)
  }

  const label = billed ? billed.label : imageGenModel(live, route.model).label
  const candidates = await Promise.all(
    panels.map(async (panel): Promise<SlotCandidate> => {
      const summary = `${set.name}, facing ${panel.direction}`
      if (mocked) {
        // A self-contained data: thumbnail, as every mock candidate is;
        // `chooseSetPlateAction` decodes it in place.
        const small = await sharp(panel.bytes).resize(320).png().toBuffer()
        return {
          id: `${provider}-mock-sheet-${panel.direction}`,
          provider,
          kind: 'image',
          sourceUrl: `data:image/png;base64,${small.toString('base64')}`,
          thumbUrl: `data:image/png;base64,${small.toString('base64')}`,
          width: panel.width,
          height: panel.height,
          licence: '[mock] Generated set sheet',
          summary: `[mock] ${summary}`,
        }
      }
      const contentHash = createHash('sha256').update(panel.bytes).digest('hex')
      const { key } = await putObject(
        stillKey({ projectId: set.projectId, contentHash }),
        panel.bytes,
        'image/png',
      )
      const sourceUrl = `generated://${provider}/${contentHash.slice(0, 12)}`
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: key,
        sourceUrl,
        licence: `Generated (${label}, set sheet)`,
        contentHash,
        width: panel.width,
        height: panel.height,
      })
      return {
        id: `${provider}-${contentHash.slice(0, 12)}`,
        provider,
        kind: 'image',
        sourceUrl,
        r2Key: key,
        assetId: asset.id,
        width: panel.width,
        height: panel.height,
        licence: asset.licence,
        summary,
      }
    }),
  )
  return { candidates, views: panels.map((panel) => panel.direction) }
}

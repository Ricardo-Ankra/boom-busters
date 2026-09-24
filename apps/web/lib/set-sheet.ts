import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { getSettings, upsertAssetByHash, visualCredentials } from '@boom-busters/db'
import { ValidationError } from '@boom-busters/schemas'
import type { ProjectSet, SetPlateDirection, SlotCandidate } from '@boom-busters/schemas'
import {
  imageGenAdapter,
  imageGenModel,
  imageGenPrice,
  LIVE_IMAGE_GEN_ADAPTERS,
  mockProvidersEnabled,
  stillStyleAnchors,
} from '@boom-busters/providers'
import { withCost } from '@boom-busters/cost'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getObjectBytes, putObject, stillKey } from '@/lib/storage'
import { mockContactSheet, splitContactSheet } from '@/lib/contact-sheet'
import { buildSetSheetPrompt } from '@/lib/set-plates'

/**
 * "Build the set" (decision 275): one contact sheet of the room from four
 * sides, on the `setSheet` route at 4K, with the set's north plate as the
 * reference, cut into four candidates the Set card offers like any other.
 */

export const UNSPLIT_SHEET =
  'The sheet came back without clear borders, so it was not split; build the set again.'

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

export async function buildSetSheet(
  set: ProjectSet,
): Promise<{ candidates: SlotCandidate[]; views: SetPlateDirection[] }> {
  const settings = await getSettings(db)
  const route = settings.modelRouting.setSheet
  if (route.provider !== 'google') {
    throw new ValidationError(
      'Set sheets need a Google image model; change Settings → Models → Set sheets.',
      { field: 'modelRouting.setSheet' },
    )
  }
  const prompt = buildSetSheetPrompt({
    name: set.name,
    layout: set.layout,
    look: set.look,
    styleAnchors: stillStyleAnchors(settings.brandKit),
  })
  const mocked = mockProvidersEnabled()

  let sheet: Buffer
  let sheetType = 'image/png'
  if (mocked) {
    sheet = await mockContactSheet()
  } else {
    const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    if (!keys.google) {
      throw new ValidationError(
        'Set sheets run on Gemini, but no Google key is stored in Settings → Connections.',
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
    const live = LIVE_IMAGE_GEN_ADAPTERS.google
    const result = await withCost(
      db,
      {
        provider: 'google',
        operation: 'image.generate',
        projectId: set.projectId,
        estimateUsd: imageGenPrice(live, 1, route.model, '4K'),
        meta: {
          model: route.model,
          set: set.name,
          kind: 'set-sheet',
          prompt: prompt.slice(0, 200),
        },
      },
      async () => {
        const generated = await imageGenAdapter('google').generate(
          {
            prompt,
            count: 1,
            model: route.model,
            size: '4K',
            references: [
              {
                name: set.name,
                kind: 'object',
                // The plate's own view, never a hard-coded 'north': `facing`
                // takes no 'other', so an undirected plate sends none.
                ...(plate.view === 'other' ? {} : { facing: plate.view }),
                mimeType: plate.mimeType,
                data: Buffer.from(object.bytes).toString('base64'),
              },
            ],
          },
          { apiKey: keys.google },
        )
        return { result: generated, actualUsd: generated.estimatedCostUsd }
      },
    )
    const url = result.images[0]!.url
    sheet = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    sheetType = /^data:([^;,]+)/.exec(url)?.[1] ?? sheetType
  }

  const panels = await splitContactSheet(sheet)
  if (!panels) {
    await keepUnsplitSheet(set.projectId, sheet, sheetType)
    throw new ValidationError(UNSPLIT_SHEET)
  }

  const label = imageGenModel(LIVE_IMAGE_GEN_ADAPTERS.google, route.model).label
  const candidates = await Promise.all(
    panels.map(async (panel): Promise<SlotCandidate> => {
      const summary = `${set.name}, facing ${panel.direction}`
      if (mocked) {
        // A self-contained data: thumbnail, as every mock candidate is;
        // `chooseSetPlateAction` decodes it in place.
        const small = await sharp(panel.bytes).resize(320).png().toBuffer()
        return {
          id: `google-mock-sheet-${panel.direction}`,
          provider: 'google',
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
      const sourceUrl = `generated://google/${contentHash.slice(0, 12)}`
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
        id: `google-${contentHash.slice(0, 12)}`,
        provider: 'google',
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

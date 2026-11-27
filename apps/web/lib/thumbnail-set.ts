import 'server-only'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { NonRetriableError } from 'inngest'
import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { withCost } from '@boom-busters/cost'
import {
  channelForProject,
  clearThumbnailSetRequest,
  finishedTests,
  getChannelSettings,
  getProject,
  getThumbnailPackage,
  getWorkspace,
  ideaResults,
  landComposedThumbnail,
  landPaintedPicture,
  listCastMembers,
  listDismissedCastNames,
  listShotSlots,
  listThumbnailPackages,
  mergePublishMetadata,
  publishRecords,
  replaceUnapprovedGenerated,
  updateThumbnailPackage,
  visualCredentials,
} from '@boom-busters/db'
import {
  buildThumbnailChangePrompt,
  buildThumbnailPicturePrompt,
  buildThumbnailSetRequest,
  imageGenPrice,
  mockProvidersEnabled,
  mockThumbnailSet,
  parseThumbnailSet,
} from '@boom-busters/providers'
import type { ImageReference } from '@boom-busters/providers'
import {
  BudgetExceededError,
  changeNoteIssue,
  depictedMembers,
  IDEA_LABELS,
  MAX_CHARACTER_REFERENCES,
  PACKAGES_MAX,
  resolveBrandKit,
  ShotBriefSchema,
  SlotCandidateSchema,
  spreadReferencePhotos,
  ValidationError,
  vetPlannedPackages,
  whatHasWon,
} from '@boom-busters/schemas'
import type { PlannedPackage, ThumbnailIdea } from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { stillCatalogue, stillGenerator } from '@/lib/model-catalogue'
import { metadataGrounding, titleFrameFor } from '@/lib/publish-grounding'
import { descriptionIngredients } from '@/lib/publish-review'
import {
  deleteObject,
  getObjectBytes,
  presignGet,
  putObject,
  storageConfigured,
  thumbnailComposedKey,
  thumbnailPictureKey,
} from '@/lib/storage'
import { composeThumbnail } from '@/lib/thumbnail-compose'
import { requireCompleteBible } from '@/inngest/lib/channel'

/**
 * The thumbnail set (design 2026-11-24, 7.1 to 7.4): one planner call for the
 * free places, one picture painted per package, each composed with its
 * headline and the channel's mark. Every paid call goes through `withCost`.
 */

const MOCK_BYTES = 'bW9jaw=='
const MOCK_PREFIX = 'mock-'
/** The most raw image bytes one change request carries: the picture first, then portraits while they fit. */
export const CHANGE_IMAGES_MAX_BYTES = 12 * 1024 * 1024

const BUDGET_REFUSAL =
  'The monthly spend ceiling would be crossed by this picture, so it was not painted. ' +
  'Approve more budget, then paint it again.'

/** What a stored image's key says its type is; stills and photographs are png, jpeg or webp. */
function mimeOfKey(key: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  const ext = key.split('.').pop()?.toLowerCase()
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'webp'
      ? 'image/webp'
      : 'image/png'
}

const extOf = (mimeType: string): string =>
  mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'

/** The planner's answer could not be read at all. */
class UnplannableError extends Error {}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

async function thumbnailRoute(channelId: string) {
  const settings = await getChannelSettings(db, channelId)
  const route = settings.modelRouting.thumbnails
  const catalogue = await stillCatalogue({
    routing: settings.modelRouting,
    prices: (await getWorkspace(db)).settings.modelPrices,
  })
  return { settings, route, catalogue, live: catalogue[route.provider] }
}

/** What `images` pictures cost on the routed model at 2K: the figure the buttons show and the ledger reserves. */
export async function thumbnailSetEstimateUsd(channelId: string, images: number): Promise<number> {
  const { route, live } = await thumbnailRoute(channelId)
  return imageGenPrice(live, images, route.model, '2K')
}

/**
 * Both facts the Publish card needs from the thumbnail route, read once: the
 * price of `places` pictures (null when none are free) and the left-out label.
 */
export async function thumbnailRouteFacts(
  channelId: string,
  places: number,
): Promise<{ costUsd: number | null; styleLeftOut: string | null }> {
  const { settings, route, live } = await thumbnailRoute(channelId)
  const costUsd = places > 0 ? imageGenPrice(live, places, route.model, '2K') : null
  const unused =
    settings.thumbnails.references.some((reference) => reference.inUse) &&
    live.referenceLimits(route.model).styles <= 0
  const styleLeftOut = unused
    ? (live.models.find((model) => model.id === route.model)?.label ?? route.model)
    : null
  return { costUsd, styleLeftOut }
}

export type FilmStill = {
  slotId: string
  shows: string
  depicts: string[]
  r2Key: string
  mimeType: string
}

/** The film's chosen stills and hero frames that are stored images: what a picture can be built from. */
export async function filmStills(projectId: string): Promise<FilmStill[]> {
  const slots = await listShotSlots(db, projectId)
  const found: FilmStill[] = []
  for (const slot of slots) {
    if (slot.type !== 'still' && slot.type !== 'hero') continue
    const brief = ShotBriefSchema.safeParse(slot.brief)
    if (!brief.success) continue
    const chosen = slot.candidates
      .map((candidate) => SlotCandidateSchema.safeParse(candidate))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
      .find(
        (candidate) => candidate.chosen === true && candidate.r2Key && candidate.kind === 'image',
      )
    if (!chosen?.r2Key) continue
    const depicts =
      brief.data.type === 'still' || brief.data.type === 'hero'
        ? (brief.data.depicts ?? chosen.references ?? [])
        : []
    found.push({
      slotId: slot.id,
      shows: brief.data.description,
      depicts,
      r2Key: chosen.r2Key,
      mimeType: mimeOfKey(chosen.r2Key),
    })
  }
  return found
}

type Frozen = Awaited<ReturnType<typeof channelForProject>>

/** Plans the free places of a record's set, vets them, and stores what survives. */
export async function planThumbnailSet(input: {
  projectId: string
  publishRecordId: string
}): Promise<{ inserted: string[]; dropped: { idea: ThumbnailIdea; reason: string }[] }> {
  const { projectId, publishRecordId } = input
  const rows = await listThumbnailPackages(db, publishRecordId)
  const approved = rows.filter((row) => row.approvedAt !== null)
  const places = PACKAGES_MAX - approved.length
  if (places <= 0) {
    await clearThumbnailSetRequest(db, publishRecordId)
    return { inserted: [], dropped: [] }
  }
  const approvedIdeas = approved.flatMap((row) => (row.idea === null ? [] : [row.idea]))

  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const frozen: Frozen = requireCompleteBible(await channelForProject(db, projectId))
  const mocked = mockProvidersEnabled()

  const [grounding, members, dismissed, stills] = await Promise.all([
    metadataGrounding(projectId),
    listCastMembers(db, projectId),
    listDismissedCastNames(db, projectId),
    filmStills(projectId),
  ])
  // Mock mode needs no real claims: one synthetic claim stands in when the
  // project has none, so the mock set can pass the vet.
  const claims =
    mocked && grounding.claims.length === 0
      ? [{ id: 'mock-claim', text: project.title }]
      : grounding.claims.map((claim) => ({ id: claim.id, text: claim.text }))

  const planned = async (wanted: number, held: ThumbnailIdea[]): Promise<PlannedPackage[]> => {
    if (mocked) {
      return mockThumbnailSet({
        workingTitle: project.title,
        places: wanted,
        heldIdeas: held,
        claimIds: claims.map((claim) => claim.id),
      })
    }
    const [{ hook }, frame] = await Promise.all([
      descriptionIngredients(db, projectId),
      titleFrameFor(projectId, project, frozen),
    ])
    const { settings } = frozen
    const [byIdea, finished] = await Promise.all([
      ideaResults(db, frozen.channelId),
      finishedTests(db, frozen.channelId),
    ])
    const pastResults = whatHasWon(byIdea, finished.withWinner)
    const answer = await callForAnswer({
      request: buildThumbnailSetRequest({
        bible: frozen,
        channelName: frozen.name,
        caseTitle: project.caseTitle,
        hook: hook || project.title,
        claims: grounding.claims,
        cast: members.map((member) => ({
          name: member.name,
          role: member.role,
          guardrail: member.guardrail,
        })),
        stills: stills.map((still) => ({
          slotId: still.slotId,
          shows: still.shows,
          depicts: still.depicts,
        })),
        places: wanted,
        heldIdeas: held,
        ...(frame ? { titleFrame: { pattern: frame.pattern, required: frame.required } } : {}),
        styleNote: settings.thumbnails.styleNote,
        referenceNotes: settings.thumbnails.references
          .filter((reference) => reference.inUse)
          .map((reference) => reference.note),
        ...(pastResults === null ? {} : { pastResults }),
      }),
      parse: (text) => parseThumbnailSet(text),
      complete: completeForProject(projectId, { estimateOutputTokens: 1500 }),
    })
    if (!answer.ok) throw new UnplannableError(answer.issue)
    return answer.value
  }

  const vet = (packages: PlannedPackage[], wanted: number, held: ThumbnailIdea[]) =>
    vetPlannedPackages({
      packages,
      cast: members,
      dismissed: dismissed.map((name) => ({ name })),
      claims,
      stills,
      heldIdeas: held,
      places: wanted,
    })

  const cannotPlan = async (reason: string): Promise<never> => {
    const sentence = `The set could not be planned: ${reason}`.slice(0, 500)
    await writeSetNote(publishRecordId, sentence)
    throw new NonRetriableError(sentence)
  }

  let held = approvedIdeas
  const kept: PlannedPackage[] = []
  const dropped: { idea: ThumbnailIdea; reason: string }[] = []
  try {
    const first = vet(await planned(places, held), places, held)
    kept.push(...first.kept)
    dropped.push(...first.dropped)
    if (first.dropped.length > 0 && kept.length < places) {
      // Once more for the missing places, never twice.
      held = [...approvedIdeas, ...kept.map((item) => item.idea)]
      const missing = places - kept.length
      const second = vet(await planned(missing, held), missing, held)
      kept.push(...second.kept)
      dropped.push(...second.dropped)
    }
  } catch (error) {
    if (error instanceof UnplannableError) return cannotPlan(error.message)
    throw error
  }

  const droppedWords = dropped.map((drop) => `${IDEA_LABELS[drop.idea]}: ${drop.reason}`).join(' ')
  if (kept.length === 0) {
    // The owner's painted packages are not traded for nothing.
    return cannotPlan(droppedWords === '' ? 'The planner offered no package.' : droppedWords)
  }

  const { inserted, orphanedKeys } = await replaceUnapprovedGenerated(db, publishRecordId, kept)
  if (storageConfigured()) {
    for (const key of orphanedKeys) {
      await deleteObject(key).catch((error: unknown) => {
        console.error(`A thumbnail object could not be removed (${key}):`, error)
      })
    }
  }
  await writeSetNote(
    publishRecordId,
    kept.length >= places
      ? ''
      : `Planned ${kept.length} of ${places}. ${droppedWords}`.trim().slice(0, 500),
  )
  return { inserted: inserted.map((row) => row.id), dropped }
}

/** The run's words for the Publish card: merged over the draft in the record's metadata, never replacing it. */
export async function writeSetNote(publishRecordId: string, note: string): Promise<void> {
  // Saying how the plan ended is also the write that finishes it: the claim goes in the same statement.
  await mergePublishMetadata(db, publishRecordId, { thumbnailSetNote: note }, [
    'thumbnailSetRequestedAt',
  ])
}

/** The master a record belongs to: its target is the project's id. Generated sets are for masters only. */
async function masterOf(publishRecordId: string): Promise<string> {
  const [record] = await db
    .select({ targetId: publishRecords.targetId, targetType: publishRecords.targetType })
    .from(publishRecords)
    .where(eq(publishRecords.id, publishRecordId))
  if (!record) throw new NonRetriableError(`Publish record ${publishRecordId} no longer exists`)
  if (record.targetType !== 'master') {
    throw new NonRetriableError(
      "Generated sets are for the full film. A Short's thumbnail is an upload.",
    )
  }
  return record.targetId
}

/** The generated image's bytes: Gemini inline as a data: URL, fal as an expiring URL. */
async function imageBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (url.startsWith('data:')) {
    return {
      bytes: Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'),
      mimeType: /^data:([^;,]+)/.exec(url)?.[1] ?? 'image/png',
    }
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new ValidationError(`The picture could not be fetched (${response.status}).`)
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'image/png',
  }
}

async function referenceBytes(key: string, mocked: boolean): Promise<string> {
  if (mocked) return MOCK_BYTES
  const object = await getObjectBytes(key)
  return Buffer.from(object.bytes).toString('base64')
}

/**
 * Paints one package's picture. Never throws: every exit ends in a stored picture (still `painting`, awaiting compose) or a failed row with words.
 *
 * With a `note` the stored picture goes to the model to be edited, with the portraits of
 * the people it shows (no stills, no styles). `baseKey` is the picture the request was
 * made against: when the row's picture has moved on (a retried run), nothing is painted.
 */
export async function paintThumbnailPicture(
  packageId: string,
  options: { baseKey?: string | null; note?: string } = {},
): Promise<void> {
  try {
    const row = await getThumbnailPackage(db, packageId)
    if (!row) return
    if (options.baseKey !== undefined && options.baseKey !== row.pictureKey) return
    const note = options.note
    await updateThumbnailPackage(db, packageId, { state: 'painting', error: null })
    if (!row.picture) throw new ValidationError('This package has no picture brief to paint.')
    if (note !== undefined && row.pictureKey === null) {
      throw new ValidationError('There is no picture to change. Regenerate the picture.')
    }
    const picture = row.picture
    const projectId = await masterOf(row.publishRecordId)
    const targetId = projectId
    const mocked = mockProvidersEnabled()
    const { settings, route, catalogue, live } = await thumbnailRoute(
      (await channelForProject(db, projectId)).channelId,
    )
    const provider = route.provider
    const keys = mocked ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    const apiKey = provider === 'google' ? keys.google : keys.fal
    if (!mocked && !apiKey) {
      throw new ValidationError(
        `Thumbnails are painted on ${provider === 'google' ? 'Gemini' : 'fal.ai'}, but no key for it ` +
          'is stored in Settings, Connections.',
      )
    }

    const limits = live.referenceLimits(route.model)
    const cast = await listCastMembers(db, projectId)
    if (note !== undefined) {
      // The action checks this too; an event sent any other way is checked here, before any buying.
      const dismissed = await listDismissedCastNames(db, projectId)
      const issue = changeNoteIssue({
        note,
        depicts: row.depicts,
        cast,
        dismissed: dismissed.map((name) => ({ name })),
      })
      if (issue) throw new ValidationError(issue)
    }
    const depicted = depictedMembers(picture.depicts, cast)
    const stills = (await filmStills(projectId)).filter((still) =>
      picture.stillSlotIds.includes(still.slotId),
    )

    const characterShots = spreadReferencePhotos(
      depicted,
      Math.min(MAX_CHARACTER_REFERENCES, limits.characters),
    )
    // A change edits the picture it is given: the film's stills and the style references stay out.
    const objectShots = note !== undefined ? [] : stills.slice(0, Math.max(0, limits.objects))
    const styleShots =
      note === undefined && limits.styles > 0
        ? settings.thumbnails.references
            .filter((reference) => reference.inUse)
            .slice(0, limits.styles)
        : []

    const references: ImageReference[] = []
    const storedKeys: string[] = []
    let sizeSent = 0
    if (note !== undefined && row.pictureKey !== null) {
      const data = await referenceBytes(row.pictureKey, mocked)
      references.push({
        name: 'The picture to edit',
        kind: 'base',
        mimeType: mimeOfKey(row.pictureKey),
        data,
      })
      storedKeys.push(row.pictureKey)
      sizeSent = Buffer.byteLength(data, 'base64')
    }
    const portraitsSent: typeof characterShots = []
    for (const { member, photo } of characterShots) {
      const data = await referenceBytes(photo.r2Key, mocked)
      // The first portrait that would pass the cap, and every one after it, stay out.
      const size = Buffer.byteLength(data, 'base64')
      if (note !== undefined && sizeSent + size > CHANGE_IMAGES_MAX_BYTES) break
      sizeSent += size
      portraitsSent.push({ member, photo })
      references.push({
        name: member.name,
        kind: 'character',
        mimeType: photo.mimeType,
        data,
      })
      storedKeys.push(photo.r2Key)
    }
    for (const still of objectShots) {
      references.push({
        name: still.shows.slice(0, 80),
        kind: 'object',
        mimeType: still.mimeType as ImageReference['mimeType'],
        data: await referenceBytes(still.r2Key, mocked),
      })
      storedKeys.push(still.r2Key)
    }
    for (const style of styleShots) {
      references.push({
        name: style.note.trim() === '' ? 'Style reference' : style.note,
        kind: 'style',
        mimeType: style.mimeType,
        data: await referenceBytes(style.r2Key, mocked),
      })
      storedKeys.push(style.r2Key)
    }
    // fal's reference endpoints want URLs, not bytes.
    const referenceUrls =
      provider === 'fal'
        ? await Promise.all(
            storedKeys.map(async (key) => (mocked ? `mock://${key}` : presignGet(key))),
          )
        : []

    const guardrails = depicted.map((member) => ({
      name: member.name,
      guardrail: member.guardrail,
    }))
    const people = [...new Set(portraitsSent.map(({ member }) => member.name))]
    const prompt =
      note !== undefined
        ? buildThumbnailChangePrompt({
            note,
            textSide: row.textSide === 'right' ? 'right' : 'left',
            styleNote: settings.thumbnails.styleNote,
            guardrails,
            attached: { people },
          })
        : buildThumbnailPicturePrompt({
            picture,
            styleNote: settings.thumbnails.styleNote,
            guardrails,
            attached: { people, stills: objectShots.length, styles: styleShots.length },
          })

    const billed = live.referenceRoute?.(route.model, referenceUrls.length) ?? null
    const adapter = stillGenerator(provider, catalogue)
    let generated: { url: string }
    try {
      const result = await withCost(
        db,
        {
          provider,
          operation: 'image.generate',
          projectId,
          estimateUsd: billed ? billed.pricePerImage : imageGenPrice(live, 1, route.model, '2K'),
          meta: {
            model: billed ? billed.id : route.model,
            kind: 'thumbnail',
            package: packageId,
            prompt: prompt.slice(0, 200),
            ...(note !== undefined ? { change: note.slice(0, 200) } : {}),
          },
        },
        async () => {
          const out = await adapter.generate(
            {
              prompt,
              count: 1,
              size: '2K',
              ...(mocked ? {} : { model: route.model }),
              ...(references.length > 0 ? { references } : {}),
              ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
            },
            { ...(apiKey ? { apiKey } : {}) },
          )
          return { result: out, actualUsd: out.estimatedCostUsd }
        },
      )
      const image = result.images[0]
      if (!image) throw new ValidationError('The image model returned no picture.')
      generated = image
    } catch (error) {
      if (error instanceof BudgetExceededError) throw new ValidationError(BUDGET_REFUSAL)
      throw error
    }

    let pictureKey: string
    if (mocked) {
      // Mock mode writes no object: the key says where a real one would live.
      pictureKey = thumbnailPictureKey({
        targetId,
        contentHash:
          note === undefined
            ? `${MOCK_PREFIX}${packageId}`
            : `${MOCK_PREFIX}${packageId}-${createHash('sha256').update(note).digest('hex').slice(0, 8)}`,
        ext: 'png',
      })
    } else {
      const { bytes, mimeType } = await imageBytes(generated.url)
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      pictureKey = thumbnailPictureKey({ targetId, contentHash, ext: extOf(mimeType) })
      await putObject(pictureKey, bytes, mimeType)
    }
    // The package is ready only once composed; until then it stays painting. The helper
    // keeps the picture it replaced and says which objects no row names any more.
    const { deleteKeys } = await landPaintedPicture(db, packageId, pictureKey)
    if (!mocked && storageConfigured()) {
      for (const key of deleteKeys) {
        if (!key.includes(`/${MOCK_PREFIX}`)) await deleteObject(key).catch(() => undefined)
      }
    }
  } catch (error) {
    // Even the failure write must not rethrow: the run's onFailure marks what is left.
    await updateThumbnailPackage(db, packageId, {
      state: 'failed',
      error: errorMessage(error),
    }).catch(() => undefined)
  }
}

/** A key as something the page can load: a presigned URL, or a data URI when there is no signing. */
async function loadable(key: string): Promise<string> {
  if (storageConfigured()) return presignGet(key)
  const object = await getObjectBytes(key)
  return `data:${object.contentType};base64,${Buffer.from(object.bytes).toString('base64')}`
}

/** Sets the headline and the mark on a package's picture. Never throws: a failure becomes a failed row, the picture kept. */
export async function composeThumbnailPackage(packageId: string): Promise<void> {
  const row = await getThumbnailPackage(db, packageId)
  if (!row) return
  try {
    if (row.pictureKey === null)
      throw new ValidationError('This package has no picture to compose.')
    const projectId = await masterOf(row.publishRecordId)
    const targetId = projectId

    if (mockProvidersEnabled()) {
      // No browser and no object in mock mode.
      const composedKey = thumbnailComposedKey({
        targetId,
        contentHash: `${MOCK_PREFIX}${packageId}`,
      })
      await landComposedThumbnail(db, packageId, { composedKey, warnings: [] })
      return
    }

    const channel = await channelForProject(db, projectId)
    const kit = resolveBrandKit(channel.settings, { name: channel.name, handle: channel.handle })
    const logoKey = kit.look.logoR2Key
    const { jpeg, warnings } = await composeThumbnail({
      pictureSrc: await loadable(row.pictureKey),
      headline: row.headline,
      textSide: row.textSide === 'right' ? 'right' : 'left',
      brand: graphicBrand(kit),
      mark: logoKey ? { src: await loadable(logoKey) } : { wordmark: channel.name },
      markPlacement: channel.settings.thumbnails.markPlacement,
    })
    const contentHash = createHash('sha256').update(jpeg).digest('hex')
    const composedKey = thumbnailComposedKey({ targetId, contentHash })
    await putObject(composedKey, jpeg, 'image/jpeg')
    // The new object is stored first; the helper decides under the record's lock
    // whether it lands, and says which objects are now unreferenced.
    const { deleteKeys } = await landComposedThumbnail(db, packageId, { composedKey, warnings })
    for (const key of deleteKeys) {
      if (!key.includes(`/${MOCK_PREFIX}`)) await deleteObject(key).catch(() => undefined)
    }
  } catch (error) {
    await updateThumbnailPackage(db, packageId, { state: 'failed', error: errorMessage(error) })
  }
}

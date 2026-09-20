import 'server-only'

import { createHash } from 'node:crypto'
import { round4, withCost } from '@boom-busters/cost'
import {
  getSettings,
  listCastMembers,
  listProjectSets,
  upsertAssetByHash,
  visualCredentials,
} from '@boom-busters/db'
import {
  applyScores,
  articleIsRenderable,
  depictedMembers,
  referencePhotos,
  referencePlates,
  setForBrief,
  STILL_GENERATIONS,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  CastMember,
  CastPhoto,
  ModelRouting,
  ProjectSet,
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  StillBrief,
  StockBrief,
} from '@boom-busters/schemas'
import {
  buildScoringRequest,
  imageGenAdapter,
  imageGenModel,
  imageGenPrice,
  LIVE_IMAGE_GEN_ADAPTERS,
  mockProvidersEnabled,
  mockScores,
  parseScores,
  stockAdapter,
} from '@boom-busters/providers'
import type { ImageReference, ReferenceLimits, StockQuery } from '@boom-busters/providers'
import { articleForClaim } from '@/lib/article-source'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
import { getObjectBytes, presignGet, putObject, stillKey, storageConfigured } from '@/lib/storage'

/**
 * What one still carries, as the app's own policy (decision 264). The routed
 * model's own limits sit above this and are asked for separately; these are
 * what a still can usefully hold.
 *
 * Character slots are spent on the people in the frame first and then on
 * further angles of them (decision 253, amended). Object slots hold the
 * named set's plates. People come first when both cannot fit, because a
 * wrong face is worse than a wrong room.
 */
export const MAX_CHARACTER_REFERENCES = 3
export const MAX_SET_REFERENCES = 2

/** The clause the planner is asked to write; prepended if it forgot. */
const REFERENCE_CLAUSE = 'the person in the reference photo'

/** Names the set's plate the same way, since the adapter sends flat inline images. */
const SET_REFERENCE_CLAUSE = 'the room in the reference photograph'

/**
 * How the reference slots are spent across the people in the frame.
 *
 * Everyone depicted gets a photograph first, because a face that is never
 * shown cannot be matched at all. Whatever is left goes round-robin to
 * further angles of those same people, front view first. One person in the
 * frame is the common case, and three views of them pin a likeness far
 * better than one — which is what the Cast card has been asking for all
 * along, and what every angle past the first was never used for.
 *
 * The extra angles are only ever spent on photographs the producer actually
 * uploaded, so a cast of single front views behaves exactly as before.
 */
function spreadReferences(
  members: readonly CastMember[],
  budget: number,
): { member: CastMember; photo: CastPhoto }[] {
  const queues = members.map((member) =>
    referencePhotos(member, budget).map((photo) => ({ member, photo })),
  )
  const chosen: { member: CastMember; photo: CastPhoto }[] = []
  for (let round = 0; round < budget; round += 1) {
    for (const queue of queues) {
      if (chosen.length >= budget) return chosen
      const next = queue[round]
      if (next) chosen.push(next)
    }
  }
  return chosen
}

/**
 * The people this still can actually show a likeness of: the cast members it
 * depicts who have a photograph.
 *
 * This is THE rule, and it is pure so that the generator and the price
 * estimate cannot answer it differently. They did once: the estimate assumed
 * the dearer route for every still and quoted a number no run would ever
 * spend (decision 253, amended). It also has to be settled before the route
 * is chosen, because whether a still needs a likeness is what decides which
 * generator it goes to.
 *
 * A name the cast has never seen, or one with no photograph yet, is not a
 * likeness the app can produce, so such a still is routed, priced and
 * generated as a plain one.
 *
 * Which entry names which member is `depictedMembers` (decision 262). The
 * planner is asked for the name alone and has written "Emad Mostaque,
 * founder and former CEO of Stability AI"; an exact-string join here sent
 * every such still to the plain route, and the estimate agreed with it.
 */
function depictedFrom(brief: StillBrief, cast: readonly CastMember[]): CastMember[] {
  return depictedMembers(brief.depicts, cast)
    .filter((member) => member.photos.length > 0)
    .slice(0, MAX_CHARACTER_REFERENCES)
}

async function depictedCast(brief: StillBrief, projectId: string): Promise<CastMember[]> {
  if (!brief.depicts || brief.depicts.length === 0) return []
  return depictedFrom(brief, await listCastMembers(db, projectId))
}

/**
 * The set this still is shot in, if the project holds it and it has a plate.
 * A named set nobody has photographed conditions nothing, exactly like a
 * `depicts` name with no photograph, so it is treated as no set at all and
 * the plan screen says so.
 */
async function setForStill(brief: StillBrief, projectId: string): Promise<ProjectSet | null> {
  if (!brief.set) return null
  const found = setForBrief(brief.set, await listProjectSets(db, projectId))
  return found && found.plates.length > 0 ? found : null
}

/** Where a still goes, given who it shows. A null likeness route means no split. */
function routeFor(members: readonly CastMember[], routing: ModelRouting) {
  return members.length > 0 && routing.stillsLikeness ? routing.stillsLikeness : routing.stills
}

/**
 * What one still brief will cost: its own route, and on fal its own reference
 * endpoint, which is dearer than the routed model and dearer again for more
 * than one photograph — a set plate is one more reference on that count, the
 * same as a person's. Priced from the LIVE adapters even in mock mode, the
 * same rule as every mock — budgets are configuration that outlives a test run.
 */
async function stillBriefPriceUsd(
  brief: StillBrief,
  cast: readonly CastMember[],
  routing: ModelRouting,
  projectId: string,
): Promise<number> {
  const members = depictedFrom(brief, cast)
  const route = routeFor(members, routing)
  const live = LIVE_IMAGE_GEN_ADAPTERS[route.provider]
  const limits = live.referenceLimits(route.model)
  const set = await setForStill(brief, projectId)
  const characterCount = spreadReferences(
    members,
    Math.min(MAX_CHARACTER_REFERENCES, limits.characters),
  ).length
  const plateCount = set
    ? referencePlates(set, Math.min(MAX_SET_REFERENCES, limits.objects)).length
    : 0
  const billed = live.referenceRoute?.(route.model, characterCount + plateCount) ?? null
  return billed
    ? billed.pricePerImage * STILL_GENERATIONS
    : imageGenPrice(live, STILL_GENERATIONS, route.model)
}

/**
 * What a set of planned still briefs will cost to generate, priced one brief
 * at a time — the plan screen's "Fetch visuals · est. $X".
 *
 * Exact rather than conservative, which is the whole point of showing a
 * number: at the plan checkpoint every brief is already written, so which
 * route each slot takes and how many reference photographs travel with it
 * are known facts, not guesses. One settings read and one cast read for the
 * whole list.
 */
export async function stillsEstimateUsd(
  briefs: readonly ShotBrief[],
  projectId: string,
): Promise<number> {
  const stills = briefs.filter((brief): brief is StillBrief => brief.type === 'still')
  if (stills.length === 0) return 0
  const routing = (await getSettings(db)).modelRouting
  const cast = await listCastMembers(db, projectId)
  const prices = await Promise.all(
    stills.map((brief) => stillBriefPriceUsd(brief, cast, routing, projectId)),
  )
  return round4(prices.reduce((total, price) => total + price, 0))
}

/**
 * Those members' photographs and the named set's plates, in the shape the
 * routed generator wants (decision 253, amended 264): Gemini takes bytes
 * inline, fal takes URLs. Storage that cannot be read (no bucket in a dev
 * environment) falls back to text rather than failing the slot.
 *
 * The app's own policy caps each pool before the routed model's own limits
 * are even asked to refuse anything (decision 264): three character slots
 * and two object slots at most, and never more than the model allows. People
 * are spent first, because a wrong face is worse than a wrong room.
 */
async function referenceMaterials(
  members: readonly CastMember[],
  set: ProjectSet | null,
  provider: 'google' | 'fal',
  limits: ReferenceLimits,
  mocked: boolean,
): Promise<{
  names: string[]
  setName: string | null
  references: ImageReference[]
  referenceUrls: string[]
}> {
  const none = { names: [], setName: null, references: [], referenceUrls: [] }
  const characterBudget = Math.min(MAX_CHARACTER_REFERENCES, limits.characters)
  const objectBudget = Math.min(MAX_SET_REFERENCES, limits.objects)
  const photos = spreadReferences(members, characterBudget)
  const plates = set ? referencePlates(set, objectBudget) : []
  if (photos.length === 0 && plates.length === 0) return none

  const names = members.map((member) => member.name)
  const setName = plates.length > 0 && set ? set.name : null
  const plateName = setName ?? ''

  if (mocked) {
    return {
      names,
      setName,
      references: [
        ...photos.map(({ member, photo }) => ({
          name: member.name,
          kind: 'character' as const,
          mimeType: photo.mimeType,
          data: 'bW9jaw==',
        })),
        ...plates.map((plate) => ({
          name: plateName,
          kind: 'object' as const,
          mimeType: plate.mimeType,
          data: 'bW9jaw==',
        })),
      ],
      referenceUrls: [
        ...photos.map(({ photo }) => `mock://${photo.r2Key}`),
        ...plates.map((plate) => `mock://${plate.r2Key}`),
      ],
    }
  }
  try {
    if (provider === 'google') {
      const references: ImageReference[] = []
      for (const { member, photo } of photos) {
        const object = await getObjectBytes(photo.r2Key)
        references.push({
          name: member.name,
          kind: 'character',
          mimeType: photo.mimeType,
          data: Buffer.from(object.bytes).toString('base64'),
        })
      }
      for (const plate of plates) {
        const object = await getObjectBytes(plate.r2Key)
        references.push({
          name: plateName,
          kind: 'object',
          mimeType: plate.mimeType,
          data: Buffer.from(object.bytes).toString('base64'),
        })
      }
      return { names, setName, references, referenceUrls: [] }
    }
    const referenceUrls: string[] = []
    for (const { photo } of photos) referenceUrls.push(await presignGet(photo.r2Key))
    for (const plate of plates) referenceUrls.push(await presignGet(plate.r2Key))
    return {
      names,
      setName,
      references: [
        ...photos.map(({ member, photo }) => ({
          name: member.name,
          kind: 'character' as const,
          mimeType: photo.mimeType,
        })),
        ...plates.map((plate) => ({
          name: plateName,
          kind: 'object' as const,
          mimeType: plate.mimeType,
        })),
      ],
      referenceUrls,
    }
  } catch (error) {
    if (error instanceof ValidationError) return none
    throw error
  }
}

/**
 * "Emad Mostaque, the person in the reference photo, in Venture Capital
 * Boardroom, the room in the reference photograph." The adapter sends flat
 * inline images, so the prompt is the only thing that can label which is
 * which. Either clause is skipped when the planner already wrote it.
 */
function withReferenceClause(
  prompt: string,
  names: readonly string[],
  setName: string | null,
): string {
  const needsPeopleClause = names.length > 0 && !prompt.includes(REFERENCE_CLAUSE)
  const needsRoomClause = setName !== null && !prompt.includes(SET_REFERENCE_CLAUSE)
  if (!needsPeopleClause && !needsRoomClause) return prompt

  const people = names.join(' and ')
  const peoplePart = needsPeopleClause
    ? names.length === 1
      ? `${people}, ${REFERENCE_CLAUSE}`
      : `${people}, the people in the reference photos`
    : null
  const roomPart = needsRoomClause ? `in ${setName}, ${SET_REFERENCE_CLAUSE}` : null

  const clause = [peoplePart, roomPart].filter((part): part is string => part !== null).join(', ')
  return `${clause}. ${prompt}`
}

/**
 * Slot resolution — how a brief becomes candidates (build spec section 7.4).
 *
 * One function per brief type, one entry point (`resolveSlotBrief`) shared by
 * the visuals-runner's fan-out and the slot-refetcher, so "Regenerate" can
 * never behave differently from the pass that made the board.
 *
 * Money rules, in the order they bite:
 *  - Stock and archival searches are free; they are not wrapped in the cost
 *    guard because there is nothing to guard — the guard exists to stop
 *    spend, and a $0 reservation stops nothing while still writing rows.
 *  - Still generation is paid (Gemini by default, fal as the alternative),
 *    so it runs inside `withCost` and a `BudgetExceededError` propagates up
 *    for the runner to park on.
 *  - Scoring is an LLM call through `callLlm`, which carries its own guard.
 */

/** Fetched per stock provider, before scoring narrows to the shown 4. */
export const STOCK_FETCH_COUNT = 6

/**
 * Fail before the shot list is even generated when a slot type the plan will
 * need has no key behind it (spec section 6: pre-flight, never mid-pipeline).
 * Stock needs ONE of Pexels/Pixabay — two free sources exist so that one
 * missing key degrades coverage, not the stage — but zero is a hard stop.
 */
export async function requireVisualKeys(types: ReadonlySet<ShotBrief['type']>): Promise<void> {
  if (mockProvidersEnabled()) return

  const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  if (types.has('stock') && !keys.pexels && !keys.pixabay) {
    throw new ValidationError(
      'The shot list needs stock footage but neither Pexels nor Pixabay has a working key. ' +
        'Add at least one in Settings → Connections, then re-run the visuals stage.',
      { field: 'connections.pexels' },
    )
  }

  if (types.has('still')) {
    // Gemini (the Google key) is the default generator; fal is the
    // alternative. Either one satisfies the plan.
    if (!keys.google && !keys.fal) {
      throw new ValidationError(
        'The shot list includes generated stills but there is no key to generate them with. ' +
          'Add a Google key (Gemini generates the stills) or a fal.ai key in ' +
          'Settings → Connections, then re-run the visuals stage.',
        { field: 'connections.google' },
      )
    }
    if (!storageConfigured()) {
      throw new ValidationError(
        'Generated stills have nowhere to be stored, so every image would be bought and then ' +
          'lost. Configure R2, or set MOCK_PROVIDERS=1.',
        { field: 'env.R2_BUCKET' },
      )
    }
  }
}

/**
 * What ONE still will cost when there is no brief to price yet — the teaser
 * studio, whose beats are generated a button at a time before any brief
 * exists (decision 231).
 *
 * With no brief there is no knowing whom the frame will show, so this quotes
 * the dearer of the two routes and can only over-state. Wherever the briefs
 * are already planned, `stillsEstimateUsd` prices them exactly and is used
 * instead. Stock, archival, chart and map fetches are free, so stills are the
 * whole estimate either way.
 */
export async function stillSlotEstimateUsd(): Promise<number> {
  const routing = (await getSettings(db)).modelRouting
  const routes = [routing.stills, ...(routing.stillsLikeness ? [routing.stillsLikeness] : [])]
  return Math.max(
    ...routes.map((route) =>
      imageGenPrice(LIVE_IMAGE_GEN_ADAPTERS[route.provider], STILL_GENERATIONS, route.model),
    ),
  )
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/** Exported for the teaser studio's per-beat fetch (decision 231). */
export async function fetchStockCandidates(brief: StockBrief): Promise<SlotCandidate[]> {
  const keys = mockProvidersEnabled() ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  const query: StockQuery = {
    query: brief.query,
    brief: brief.description,
    rejectionCriteria: brief.rejectionCriteria,
    count: STOCK_FETCH_COUNT,
  }

  // Both sources when both have keys; whichever exists otherwise. In mock
  // mode the registry serves mocks and no key is needed.
  const sources = (['pexels', 'pixabay'] as const).filter(
    (provider) => mockProvidersEnabled() || keys[provider],
  )

  const results = await Promise.allSettled(
    sources.map((provider) =>
      stockAdapter(provider).search(query, {
        ...(keys[provider] ? { apiKey: keys[provider] } : {}),
      }),
    ),
  )

  const candidates = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  )

  // Both sources failing is a slot failure; one failing is degraded coverage,
  // which the fetch tolerates and the candidate count makes visible.
  const firstError = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (candidates.length === 0 && firstError) {
    throw firstError.reason instanceof Error
      ? firstError.reason
      : new Error(String(firstError.reason))
  }

  return candidates
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Exported for the teaser studio's per-beat generation (decision 231). */
export async function generateStillCandidates(
  brief: StillBrief,
  projectId: string,
): Promise<SlotCandidate[]> {
  const mocked = mockProvidersEnabled()
  const keys = mocked ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  /**
   * Who this still shows is settled first, because it decides where the
   * still goes (decision 253, amended). Holding a real face and inventing an
   * empty boardroom are different jobs at different prices, so a still of
   * someone the cast has photographed may be routed to one generator and
   * every other still to another. With no split configured both are the same
   * route and this changes nothing.
   */
  const members = await depictedCast(brief, projectId)
  const set = await setForStill(brief, projectId)
  const routing = (await getSettings(db)).modelRouting
  const route = routeFor(members, routing)
  const likeness = route !== routing.stills

  // Which generator and which model is `modelRouting.stills` (decision 208)
  // — a routed choice like every LLM task, not an inference from which key
  // happens to exist. In mock mode the registry serves the mock whichever id
  // is asked for, and the mock ignores the model id.
  const provider = route.provider
  const adapter = imageGenAdapter(provider)
  const apiKey = provider === 'google' ? keys.google : keys.fal
  if (!mocked && !apiKey) {
    const setting = likeness ? 'stills of the cast' : 'stills'
    throw new ValidationError(
      `${likeness ? 'Stills of the cast are' : 'Stills are'} routed to ${provider} ` +
        `(Settings → Models), but no ` +
        `${provider === 'google' ? 'Google' : 'fal.ai'} key is stored in Settings → Connections. ` +
        `Add the key, or route ${setting} at the other generator.`,
      { field: likeness ? 'modelRouting.stillsLikeness.provider' : 'modelRouting.stills.provider' },
    )
  }

  // The cast's photos and the named set's plates ride along (decision 253,
  // amended 264); the prompt names them as the people and the room in the
  // photographs. Limits come from the LIVE adapter even in mock mode, the
  // same rule as the price estimate: budgets are configuration that outlives
  // a test run.
  const live = LIVE_IMAGE_GEN_ADAPTERS[provider]
  const limits = live.referenceLimits(route.model)
  const cast = await referenceMaterials(members, set, provider, limits, mocked)
  const prompt = withReferenceClause(brief.prompt, cast.names, cast.setName)

  /**
   * The endpoint that will actually be billed. A still depicting cast members
   * leaves the routed text-to-image model for a reference endpoint, which on
   * fal costs two to four times as much, so estimating against the routed
   * model under-reserves and the ledger records a model that never ran
   * (decision 253, amended). Null everywhere else, including Gemini, which
   * takes its references inline on the same model.
   */
  const billed = live.referenceRoute?.(route.model, cast.referenceUrls.length) ?? null

  const result = await withCost(
    db,
    {
      provider,
      operation: 'image.generate',
      projectId,
      // Priced from the LIVE adapter even in mock mode — same rule as the
      // estimate button, so plan and ledger never quote different numbers.
      estimateUsd: billed
        ? billed.pricePerImage * STILL_GENERATIONS
        : imageGenPrice(live, STILL_GENERATIONS, route.model),
      meta: {
        model: billed ? billed.id : route.model,
        prompt: prompt.slice(0, 200),
        ...(cast.names.length > 0 ? { references: cast.names } : {}),
        // Recorded whenever the set resolved, even if the model's object
        // cap left no plate actually attached (decision 264): the brief
        // named a room, and that is worth keeping on the record.
        ...(set ? { set: set.name } : {}),
      },
    },
    async () => {
      const generated = await adapter.generate(
        {
          prompt,
          ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
          count: STILL_GENERATIONS,
          ...(mocked ? {} : { model: route.model }),
          ...(cast.references.length > 0 ? { references: cast.references } : {}),
          ...(cast.referenceUrls.length > 0 ? { referenceUrls: cast.referenceUrls } : {}),
        },
        { ...(apiKey ? { apiKey } : {}) },
      )
      return { result: generated, actualUsd: generated.estimatedCostUsd }
    },
  )
  const referenced = cast.names.length > 0 ? { references: cast.names } : {}

  return Promise.all(
    result.images.map(async (image, index) => {
      // Mock generations are data: SVG thumbnails — displayable as-is,
      // nothing to download, no asset row. Gated on mock mode, NOT on the
      // URL scheme: real Gemini output is also a data: URL, and it must be
      // stored, not waved through as a mock.
      if (mocked) {
        return {
          id: `${adapter.id}-mock-${index + 1}`,
          provider: adapter.id,
          kind: 'image',
          sourceUrl: image.url,
          thumbUrl: image.url,
          width: image.width,
          height: image.height,
          licence: '[mock] Generated',
          summary: `[mock] Generation ${index + 1} for: ${prompt.slice(0, 120)}`,
          ...referenced,
        } satisfies SlotCandidate
      }

      // The bytes land in R2 NOW either way; the asset row is the durable
      // record. Gemini hands them over inline as a data: URL (decode, never
      // fetch); fal hands over an expiring URL that must be fetched at once.
      let bytes: Buffer
      if (image.url.startsWith('data:')) {
        bytes = Buffer.from(image.url.slice(image.url.indexOf(',') + 1), 'base64')
      } else {
        const response = await fetch(image.url)
        if (!response.ok) {
          throw new Error(
            `${adapter.id} image ${index + 1} could not be fetched (${response.status})`,
          )
        }
        bytes = Buffer.from(await response.arrayBuffer())
      }
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      const { key } = await putObject(stillKey({ projectId, contentHash }), bytes, 'image/png')

      // A megabyte data: URL must never be written into a jsonb candidate or
      // an asset row — the stored copy in R2 is the source now.
      const sourceUrl = image.url.startsWith('data:')
        ? `generated://${adapter.id}/${contentHash.slice(0, 12)}`
        : image.url

      // The licence line names the MODEL, not just the provider: which
      // generator made a frame is provenance the licence field exists for.
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: key,
        sourceUrl,
        licence: `Generated (${billed ? billed.label : imageGenModel(live, route.model).label})`,
        contentHash,
        width: image.width,
        height: image.height,
      })

      return {
        id: `${adapter.id}-${contentHash.slice(0, 12)}`,
        provider: adapter.id,
        kind: 'image',
        sourceUrl,
        r2Key: key,
        assetId: asset.id,
        width: image.width,
        height: image.height,
        licence: asset.licence,
        ...referenced,
        summary: `Generated from: ${brief.prompt.slice(0, 120)}`,
      } satisfies SlotCandidate
    }),
  )
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export async function scoreSlotCandidates(
  brief: StockBrief,
  candidates: readonly SlotCandidate[],
  projectId: string,
): Promise<SlotCandidate[]> {
  if (candidates.length === 0) return []

  const scores = mockProvidersEnabled()
    ? mockScores(candidates)
    : parseScores((await callLlm(buildScoringRequest({ brief, candidates }), { projectId })).text)

  return applyScores(candidates, scores)
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export interface SlotResolution {
  candidates: SlotCandidate[]
  status: ShotSlotStatus
  chosenAssetId?: string | null
}

/**
 * Resolve one slot's brief into what the board shows.
 *
 * Fetched types end ranked with the top candidate pre-chosen — the board is
 * for SWAPPING a default, not assembling one from nothing, or gate 4 would
 * be forty mandatory decisions instead of a review. Chart and map slots
 * resolve on their own data. Hero slots are placeholders while the flag is
 * off. Zero candidates is a `placeholder`, loudly, never a silent empty strip.
 *
 * `BudgetExceededError` (still generation, scoring) propagates to the caller;
 * everything else is the caller's per-item failure to count against the
 * fan-out tolerance.
 */
export async function resolveSlotBrief(input: {
  projectId: string
  brief: ShotBrief
}): Promise<SlotResolution> {
  const { brief, projectId } = input

  switch (brief.type) {
    case 'chart':
    case 'map':
      // The payload IS the brief; there is nothing to fetch. Validity was
      // enforced when the brief was stored (charts cannot exist without
      // claim refs), so reaching here means the preview can render.
      return { candidates: [], status: 'resolved' }

    case 'headline': {
      // Nothing is downloaded: what a headline card needs is five strings, and
      // they come from the cited article's own metadata (decision 257). A page
      // that will not give them up is a placeholder with the reason on the
      // record, which the board turns into a form rather than an error.
      const article = await articleForClaim(brief.sourceClaimId)
      return {
        candidates: [],
        status: article !== null && articleIsRenderable(article) ? 'resolved' : 'placeholder',
      }
    }

    case 'hero':
      return { candidates: [], status: 'placeholder' }

    case 'still': {
      const candidates = await generateStillCandidates(brief, projectId)
      return withChoice(candidates)
    }

    case 'stock': {
      const candidates = await scoreSlotCandidates(
        brief,
        await fetchStockCandidates(brief),
        projectId,
      )
      return withChoice(candidates)
    }

    case 'archival': {
      // Real footage is the owner's to source (decision 214): nothing is
      // fetched — the Wikimedia search this used to run produced lookalikes
      // where authenticity was the whole point of the slot. The placeholder
      // status is honest ("a human must act here"), and the board renders it
      // as an upload prompt rather than a fetch failure.
      return { candidates: [], status: 'placeholder' }
    }
  }
}

function withChoice(candidates: SlotCandidate[]): SlotResolution {
  const [top, ...rest] = candidates
  if (!top) return { candidates: [], status: 'placeholder' }

  const chosen = { ...top, chosen: true }
  return {
    candidates: [chosen, ...rest],
    status: 'resolved',
    chosenAssetId: chosen.assetId ?? null,
  }
}

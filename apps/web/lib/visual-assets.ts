import 'server-only'

import { createHash } from 'node:crypto'
import { round4, withCost } from '@boom-busters/cost'
import {
  getAsset,
  getSettings,
  listCastMembers,
  listProjectSets,
  logoById,
  upsertAssetByHash,
  visualCredentials,
} from '@boom-busters/db'
import {
  applyScores,
  articleIsRenderable,
  resolveBrandKit,
  setForBrief,
  STILL_GENERATIONS,
  ValidationError,
} from '@boom-busters/schemas'
import { SOCIAL_FRAMES, socialSlotIssues } from '@boom-busters/compositions/social'
import type {
  CastMember,
  ModelRouting,
  ProjectSet,
  SetPlateDirection,
  SetPlateView,
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  StillBrief,
  StillProvider,
  StillRoute,
  StockBrief,
} from '@boom-busters/schemas'
import {
  buildScoringRequest,
  imageGenModel,
  imageGenPrice,
  mockProvidersEnabled,
  mockScores,
  parseScores,
  stockAdapter,
} from '@boom-busters/providers'
import type {
  ImageGenProvider,
  ImageReference,
  ImageSize,
  ReferenceLimits,
  StockQuery,
} from '@boom-busters/providers'
import { articleForClaim } from '@/lib/article-source'
import { db } from '@/lib/db'
import { postForUrl } from '@/lib/social-source'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
import { stillCatalogue, stillGenerator } from '@/lib/model-catalogue'
import {
  assembleStillPrompt,
  depictedFrom,
  planStillReferences,
  referenceBudgets,
  routeForBrief,
  setFrom,
} from '@/lib/still-prompt'
import type { StillKind } from '@/lib/still-prompt'
import { getObjectBytes, presignGet, putObject, stillKey, storageConfigured } from '@/lib/storage'

export { referenceBudgets, routeForBrief } from '@/lib/still-prompt'

/**
 * Whether the route's own adapter still lists its model (decision 264). A
 * model the provider has retired stays on the row long after it is gone,
 * and `imageGenModel` throws on it, so an unguarded read of a stored route
 * would take the whole project page down over one dead slot. The derived
 * route is the fallback, which is what the slot would have had anyway.
 */
function adapterOffers(
  route: StillRoute,
  catalogue: Record<StillProvider, ImageGenProvider>,
): boolean {
  return catalogue[route.provider].models.some((model) => model.id === route.model)
}

/**
 * What one still brief will cost: its own route, and on fal its own reference
 * endpoint, which is dearer than the routed model and dearer again for more
 * than one photograph. A set plate is one more reference on that count, the
 * same as a person's. Priced from the LIVE adapters even in mock mode, the
 * same rule as every mock: budgets are configuration that outlives a test
 * run. A route stored on the slot overrides the derived one, so a re-routed
 * slot is priced on what it will actually spend.
 */
async function stillBriefPriceUsd(
  brief: StillBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
  routing: ModelRouting,
  stored: StillRoute | null | undefined,
  catalogue: Record<StillProvider, ImageGenProvider>,
): Promise<number> {
  const members = depictedFrom(brief, cast)
  const derived = routeForBrief(brief, cast, sets, routing)
  const route = stored && adapterOffers(stored, catalogue) ? stored : derived
  // A route nothing prices is a wrong button price, not a dead page; the
  // fetch itself still refuses it.
  if (!adapterOffers(route, catalogue)) return 0
  const live = catalogue[route.provider]
  const budgets = referenceBudgets(live.referenceLimits(route.model))
  const set = setFrom(brief, sets)
  const plan = planStillReferences(members, set, budgets, brief.camera?.facing)
  const billed = live.referenceRoute?.(route.model, plan.photos.length + plan.plates.length) ?? null
  return billed
    ? billed.pricePerImage * STILL_GENERATIONS
    : imageGenPrice(live, STILL_GENERATIONS, route.model, '1K')
}

/**
 * What a set of planned still briefs will cost to generate, priced one brief
 * at a time — the plan screen's "Fetch visuals · est. $X".
 *
 * Exact rather than conservative, which is the whole point of showing a
 * number: at the plan checkpoint every brief is already written, so which
 * route each slot takes and how many reference photographs travel with it
 * are known facts, not guesses. One settings read, one cast read and one
 * sets read for the whole list, whatever its length.
 *
 * `routes` is a stored route per brief, in the same order as `briefs`,
 * every brief, not only stills, so the two stay aligned. A missing or null
 * entry means derive the route by rule instead of trusting a stored one.
 */
export async function stillsEstimateUsd(
  briefs: readonly ShotBrief[],
  projectId: string,
  routes?: readonly (StillRoute | null | undefined)[],
): Promise<number> {
  const stills = briefs
    .map((brief, at) => ({ brief, stored: routes?.[at] ?? null }))
    .filter(
      (entry): entry is { brief: StillBrief; stored: StillRoute | null } =>
        entry.brief.type === 'still',
    )
  if (stills.length === 0) return 0
  const settings = await getSettings(db)
  const routing = settings.modelRouting
  const catalogue = await stillCatalogue(settings)
  const cast = await listCastMembers(db, projectId)
  const sets = await listProjectSets(db, projectId)
  const prices = await Promise.all(
    stills.map(({ brief, stored }) =>
      stillBriefPriceUsd(brief, cast, sets, routing, stored, catalogue),
    ),
  )
  return round4(prices.reduce((total, price) => total + price, 0))
}

/**
 * The prompt a still would be sent with now (decision 287), for the board's
 * "Prompt sent to the model". Built by the same pieces generation uses, from
 * lists already loaded, so the preview and the call cannot disagree.
 */
export function stillPromptFor(
  brief: StillBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
  routing: ModelRouting,
  stored: StillRoute | null,
  catalogue: Record<StillProvider, ImageGenProvider>,
): string {
  const derived = routeForBrief(brief, cast, sets, routing)
  const route = stored && adapterOffers(stored, catalogue) ? stored : derived
  const live = catalogue[route.provider]
  // A route no list holds any more (decision 288) previews on the provider's
  // default model's limits; the fetch itself refuses the route.
  const limits: ReferenceLimits = adapterOffers(route, catalogue)
    ? live.referenceLimits(route.model)
    : live.referenceLimits()
  const plan = planStillReferences(
    depictedFrom(brief, cast),
    setFrom(brief, sets),
    referenceBudgets(limits),
    brief.camera?.facing,
  )
  return assembleStillPrompt({
    scene: brief.prompt,
    ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
    ...(brief.camera ? { camera: brief.camera } : {}),
    layout: setForBrief(brief.set, sets)?.layout ?? '',
    people: plan.people,
    set: plan.setName === null ? null : { name: plan.setName, plates: plan.plates.length },
  })
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
/** `ImageReference.facing` excludes 'other' (an unlabelled upload); every other view names itself. */
function plateFacing(view: SetPlateView): Pick<ImageReference, 'facing'> | Record<string, never> {
  return view === 'other' ? {} : { facing: view }
}

async function referenceMaterials(
  members: readonly CastMember[],
  set: ProjectSet | null,
  provider: 'google' | 'fal',
  budgets: { characters: number; objects: number },
  mocked: boolean,
  facing?: SetPlateDirection,
): Promise<{
  names: string[]
  setName: string | null
  /**
   * What the prompt's closing declaration counts: one entry per person with the
   * number of their photographs that actually travelled, and the set with its
   * plate count. Derived from the same `photos` and `plates` the request is
   * built from, so the sentence and the payload cannot disagree.
   */
  people: { name: string; photos: number }[]
  setPlates: number
  references: ImageReference[]
  referenceUrls: string[]
}> {
  const none = {
    names: [],
    setName: null,
    people: [] as { name: string; photos: number }[],
    setPlates: 0,
    references: [],
    referenceUrls: [],
  }
  const plan = planStillReferences(members, set, budgets, facing)
  const { photos, plates } = plan
  if (photos.length === 0 && plates.length === 0) return none
  const names = plan.people.map((person) => person.name)
  const setName = plan.setName
  const plateName = setName ?? ''
  const people = plan.people
  const setPlates = plates.length

  if (mocked) {
    return {
      names,
      setName,
      people,
      setPlates,
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
          ...plateFacing(plate.view),
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
          ...plateFacing(plate.view),
        })
      }
      return { names, setName, people, setPlates, references, referenceUrls: [] }
    }
    const referenceUrls: string[] = []
    for (const { photo } of photos) referenceUrls.push(await presignGet(photo.r2Key))
    for (const plate of plates) referenceUrls.push(await presignGet(plate.r2Key))
    return {
      names,
      setName,
      people,
      setPlates,
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
          ...plateFacing(plate.view),
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
/**
 * What one generated set plate will cost: a plate conditions on nothing (no
 * cast, no set), so it always takes the plain stills route, whatever
 * Settings says that is (decision 265). The Set card quotes this on its
 * Generate a plate button, the way the Fetch button quotes its own price.
 */
export async function plateEstimateUsd(): Promise<number> {
  const settings = await getSettings(db)
  const catalogue = await stillCatalogue(settings)
  return round4(routePriceUsd(catalogue, settings.modelRouting.stills, STILL_GENERATIONS))
}

/** What "Build the set" will spend: one 4K image on the set-sheet route (decision 275). */
export async function setSheetEstimateUsd(): Promise<number> {
  const settings = await getSettings(db)
  const catalogue = await stillCatalogue(settings)
  return round4(routePriceUsd(catalogue, settings.modelRouting.setSheet, 1, '4K'))
}

export async function stillSlotEstimateUsd(): Promise<number> {
  const settings = await getSettings(db)
  const catalogue = await stillCatalogue(settings)
  const routing = settings.modelRouting
  const routes = [routing.stills, ...(routing.stillsLikeness ? [routing.stillsLikeness] : [])]
  return Math.max(...routes.map((route) => routePriceUsd(catalogue, route, STILL_GENERATIONS)))
}

/**
 * A button's price on one route, or 0 when the route's adapter does not
 * offer its model (decision 287). These prices are read on every project
 * page and the board, and `imageGenPrice` throws on an unknown model, so a
 * route nothing can price must cost a wrong number on a button rather than
 * the whole page. Spending on it is still refused: `generateStillCandidates`
 * reads the model unguarded.
 */
function routePriceUsd(
  catalogue: Record<StillProvider, ImageGenProvider>,
  route: StillRoute,
  count: number,
  size?: ImageSize,
): number {
  if (!adapterOffers(route, catalogue)) return 0
  return imageGenPrice(catalogue[route.provider], count, route.model, size)
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

/**
 * Exported for the teaser studio's per-beat generation (decision 231).
 *
 * `stored` is the route already sitting on the slot, if any (decision 264):
 * when given it wins outright, over whatever the rule below would derive.
 */
export async function generateStillCandidates(
  brief: StillBrief,
  projectId: string,
  stored?: StillRoute | null,
  kind: StillKind = 'still',
): Promise<SlotCandidate[]> {
  const mocked = mockProvidersEnabled()
  const keys = mocked ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  /**
   * Who this still shows, and where it is shot, is settled first, because it
   * decides where the still goes (decision 253, amended 264). Holding a real
   * face or a photographed room and inventing an empty one are different
   * jobs at different prices, so a still that carries either may be routed
   * to one generator and every other still to another. With no split
   * configured both are the same route and this changes nothing.
   */
  //
  // Each list is read only when the brief can use it (the rule `setFrom`
  // states): a 48-still film must not fire 48 cast queries and 48 set
  // queries for briefs that name neither.
  const projectCast =
    brief.depicts && brief.depicts.length > 0 ? await listCastMembers(db, projectId) : []
  const projectSets = brief.set ? await listProjectSets(db, projectId) : []
  const members = depictedFrom(brief, projectCast)
  const set = setFrom(brief, projectSets)
  // The camera reaches the prompt whether or not the set has a plate yet: the
  // inventory alone still says what the camera sees (decision 275).
  const namedSet = brief.set ? setForBrief(brief.set, projectSets) : null
  const settings = await getSettings(db)
  const routing = settings.modelRouting
  const catalogue = await stillCatalogue(settings)
  const derived = routeForBrief(brief, projectCast, projectSets, routing)
  const route = stored && adapterOffers(stored, catalogue) ? stored : derived
  // By value, not by reference: a stored route equal to the plain one is the
  // plain one, and comparing object identity named the wrong setting in the
  // missing-key message every time.
  const likeness =
    route.provider !== routing.stills.provider || route.model !== routing.stills.model

  // Which generator and which model is `modelRouting.stills` (decision 208)
  // — a routed choice like every LLM task, not an inference from which key
  // happens to exist. In mock mode the registry serves the mock whichever id
  // is asked for, and the mock ignores the model id.
  const provider = route.provider
  const adapter = await stillGenerator(provider, settings)
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
  const live = catalogue[provider]
  const cast = await referenceMaterials(
    members,
    set,
    provider,
    referenceBudgets(live.referenceLimits(route.model)),
    mocked,
    brief.camera?.facing,
  )
  // The house line names no lens (decision 275 final review): a set shot's
  // lens reaches the model once, in the camera sentence.
  const prompt = assembleStillPrompt({
    scene: brief.prompt,
    ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
    ...(brief.camera ? { camera: brief.camera } : {}),
    layout: namedSet?.layout ?? '',
    people: cast.people,
    set: cast.setName === null ? null : { name: cast.setName, plates: cast.setPlates },
    kind,
  })

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
        : imageGenPrice(live, STILL_GENERATIONS, route.model, '1K'),
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
          size: '1K',
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

/**
 * A union rather than one shape with an optional asset id, so that the
 * caller writing the resolution to the row is narrowed to the resolved case
 * before it can be asked for the brief and route the candidates answered
 * (decision 264).
 */
export type SlotResolution =
  | { status: 'resolved'; candidates: SlotCandidate[]; chosenAssetId?: string | null }
  | { status: Exclude<ShotSlotStatus, 'resolved'>; candidates: SlotCandidate[] }

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
 *
 * `route` is the model the owner chose for this slot, parsed from the row by
 * the caller, or null when they chose none (decision 264). Every production
 * fetch path comes through here, so a stored route that stopped at this
 * boundary would make the board's model select decorative.
 */
export async function resolveSlotBrief(input: {
  projectId: string
  brief: ShotBrief
  route: StillRoute | null
}): Promise<SlotResolution> {
  const { brief, projectId, route } = input

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
      return article !== null && articleIsRenderable(article)
        ? { candidates: [], status: 'resolved' }
        : { candidates: [], status: 'placeholder' }
    }

    case 'graphic': {
      // Nothing is fetched and nothing is spent: the scene is the payload. A
      // logo the library does not hold, whether never matched or matched
      // then deleted since, is the one thing that can be missing, and the
      // card asks for the upload rather than a redraft. A stored `assetId`
      // is not proof by itself: the mark it names can have been removed
      // from the library after this brief was written, so a hit still
      // needs the row to actually be there.
      let owed = false
      for (const element of brief.scene.elements) {
        if (element.kind !== 'logo') continue
        if (element.assetId === undefined || (await logoById(db, element.assetId)) === null) {
          owed = true
          break
        }
      }
      return { candidates: [], status: owed ? 'placeholder' : 'resolved' }
    }

    case 'hero':
      return { candidates: [], status: 'placeholder' }

    case 'social': {
      // Nothing is downloaded and no key is required: what a social card
      // needs is the post's own words, read once through `postForUrl` and
      // checked against the same layout rule the render and the board share
      // (decision 284). A post the reader will not give up, one too long for
      // the card with no excerpt chosen, or an excerpt that does not fit is
      // a placeholder, never an unresolvable throw.
      const post = await postForUrl(brief.postUrl)
      const brand = resolveBrandKit(await getSettings(db))
      // An attached image takes room from the text only when its asset row
      // still exists, the rule the board and the assembly already apply.
      const hasMedia =
        brief.mediaAssetId !== undefined && (await getAsset(db, brief.mediaAssetId)) !== undefined
      const issues = socialSlotIssues({
        post,
        ...(brief.excerpt !== undefined ? { excerpt: brief.excerpt } : {}),
        ...(brief.emphasis !== undefined ? { emphasis: brief.emphasis } : {}),
        hasMedia,
        frames: SOCIAL_FRAMES,
        brand,
      })
      return { candidates: [], status: issues.length === 0 ? 'resolved' : 'placeholder' }
    }

    case 'still': {
      const candidates = await generateStillCandidates(brief, projectId, route)
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

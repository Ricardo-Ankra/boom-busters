import 'server-only'

import { createHash } from 'node:crypto'
import { withCost } from '@boom-busters/cost'
import {
  castMembersNamed,
  getSettings,
  upsertAssetByHash,
  visualCredentials,
} from '@boom-busters/db'
import {
  applyScores,
  referencePhotos,
  STILL_GENERATIONS,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  CastMember,
  CastPhoto,
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
import type { ImageReference, StockQuery } from '@boom-busters/providers'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
import { getObjectBytes, presignGet, putObject, stillKey, storageConfigured } from '@/lib/storage'

/**
 * The most reference photographs one still can be conditioned on: Gemini's
 * input-image limit, and about as much as any of these endpoints reads
 * usefully.
 *
 * Slots, not people. They are spent on the people in the frame first and then
 * on further angles of them (decision 253, amended): a still showing one
 * person used to spend one slot and waste two, while the Cast card asked the
 * producer for two to four angles that were then never sent.
 */
export const MAX_STILL_REFERENCES = 3

/** The clause the planner is asked to write; prepended if it forgot. */
const REFERENCE_CLAUSE = 'the person in the reference photo'

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
): { member: CastMember; photo: CastPhoto }[] {
  const queues = members.map((member) =>
    referencePhotos(member, MAX_STILL_REFERENCES).map((photo) => ({ member, photo })),
  )
  const chosen: { member: CastMember; photo: CastPhoto }[] = []
  for (let round = 0; round < MAX_STILL_REFERENCES; round += 1) {
    for (const queue of queues) {
      if (chosen.length >= MAX_STILL_REFERENCES) return chosen
      const next = queue[round]
      if (next) chosen.push(next)
    }
  }
  return chosen
}

/**
 * The cast members a still depicts, with their photos ready for the routed
 * generator (decision 253): Gemini wants bytes inline, fal wants URLs. A
 * still that depicts nobody, or people not in the cast, returns nothing and
 * generates from text as before. Storage that cannot be read (no bucket in
 * a dev environment) also falls back to text rather than failing the slot.
 */
async function castReferences(
  brief: StillBrief,
  projectId: string,
  provider: 'google' | 'fal',
  mocked: boolean,
): Promise<{ names: string[]; references: ImageReference[]; referenceUrls: string[] }> {
  const none = { names: [], references: [], referenceUrls: [] }
  if (!brief.depicts || brief.depicts.length === 0) return none
  const members = (await castMembersNamed(db, projectId, brief.depicts))
    .filter((member) => member.photos.length > 0)
    .slice(0, MAX_STILL_REFERENCES)
  if (members.length === 0) return none

  const names = members.map((member) => member.name)
  const photos = spreadReferences(members)

  if (mocked) {
    return {
      names,
      references: photos.map(({ member, photo }) => ({
        name: member.name,
        mimeType: photo.mimeType,
        data: 'bW9jaw==',
      })),
      referenceUrls: photos.map(({ photo }) => `mock://${photo.r2Key}`),
    }
  }
  try {
    if (provider === 'google') {
      const references: ImageReference[] = []
      for (const { member, photo } of photos) {
        const object = await getObjectBytes(photo.r2Key)
        references.push({
          name: member.name,
          mimeType: photo.mimeType,
          data: Buffer.from(object.bytes).toString('base64'),
        })
      }
      return { names, references, referenceUrls: [] }
    }
    const referenceUrls: string[] = []
    for (const { photo } of photos) referenceUrls.push(await presignGet(photo.r2Key))
    return {
      names,
      references: photos.map(({ member, photo }) => ({
        name: member.name,
        mimeType: photo.mimeType,
      })),
      referenceUrls,
    }
  } catch (error) {
    if (error instanceof ValidationError) return none
    throw error
  }
}

/** "Emad Mostaque, the person in the reference photo. <prompt>" unless the planner already said so. */
function withReferenceClause(prompt: string, names: readonly string[]): string {
  if (names.length === 0 || prompt.includes(REFERENCE_CLAUSE)) return prompt
  const people = names.join(' and ')
  const clause =
    names.length === 1
      ? `${people}, ${REFERENCE_CLAUSE}.`
      : `${people}, the people in the reference photos.`
  return `${clause} ${prompt}`
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
 * What one still slot will cost to generate, for the plan screen's "Fetch
 * visuals · est. $X" button (staged-visuals design): the price of the routed
 * generator (`modelRouting.stills`, decision 208) — the same choice
 * `generateStillCandidates` makes — times the generations a prompt buys.
 * Priced from the LIVE adapter even in mock mode, the same rule as every
 * mock: budgets are configuration that outlives a test run. Stock, archival,
 * chart and map fetches are free, so stills are the whole estimate.
 */
export async function stillSlotEstimateUsd(): Promise<number> {
  const route = (await getSettings(db)).modelRouting.stills
  return imageGenPrice(LIVE_IMAGE_GEN_ADAPTERS[route.provider], STILL_GENERATIONS, route.model)
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

  // Which generator and which model is `modelRouting.stills` (decision 208)
  // — a routed choice like every LLM task, not an inference from which key
  // happens to exist. In mock mode the registry serves the mock whichever id
  // is asked for, and the mock ignores the model id.
  const route = (await getSettings(db)).modelRouting.stills
  const provider = route.provider
  const adapter = imageGenAdapter(provider)
  const apiKey = provider === 'google' ? keys.google : keys.fal
  if (!mocked && !apiKey) {
    throw new ValidationError(
      `Stills are routed to ${provider} (Settings → Models), but no ` +
        `${provider === 'google' ? 'Google' : 'fal.ai'} key is stored in Settings → Connections. ` +
        'Add the key, or route stills at the other generator.',
      { field: 'modelRouting.stills.provider' },
    )
  }

  // The cast's photos ride along for every depicted member who has one
  // (decision 253); the prompt names them as the people in the photos.
  const cast = await castReferences(brief, projectId, provider, mocked)
  const prompt = withReferenceClause(brief.prompt, cast.names)

  /**
   * The endpoint that will actually be billed. A still depicting cast members
   * leaves the routed text-to-image model for a reference endpoint, which on
   * fal costs two to four times as much, so estimating against the routed
   * model under-reserves and the ledger records a model that never ran
   * (decision 253, amended). Null everywhere else, including Gemini, which
   * takes its references inline on the same model.
   */
  const live = LIVE_IMAGE_GEN_ADAPTERS[provider]
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

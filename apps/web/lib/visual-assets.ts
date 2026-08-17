import 'server-only'

import { createHash } from 'node:crypto'
import { withCost } from '@boom-busters/cost'
import { upsertAssetByHash, visualCredentials } from '@boom-busters/db'
import { applyScores, STILL_GENERATIONS, ValidationError } from '@boom-busters/schemas'
import type {
  ArchivalBrief,
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  StillBrief,
  StockBrief,
} from '@boom-busters/schemas'
import {
  buildScoringRequest,
  imageGenAdapter,
  imageGenPrice,
  mockProvidersEnabled,
  mockScores,
  parseScores,
  stockAdapter,
} from '@boom-busters/providers'
import type { ImageGenProviderId, StockQuery } from '@boom-busters/providers'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { callLlm } from '@/lib/llm'
import { putObject, stillKey, storageConfigured } from '@/lib/storage'

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

/** Fetched from Commons for an archival slot. */
export const ARCHIVAL_FETCH_COUNT = 8

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

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchStockCandidates(brief: StockBrief): Promise<SlotCandidate[]> {
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

async function fetchArchivalCandidates(brief: ArchivalBrief): Promise<SlotCandidate[]> {
  return stockAdapter('wikimedia').search(
    {
      query: brief.query,
      brief: brief.description,
      rejectionCriteria: [],
      count: ARCHIVAL_FETCH_COUNT,
    },
    {},
  )
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function generateStillCandidates(
  brief: StillBrief,
  projectId: string,
): Promise<SlotCandidate[]> {
  const mocked = mockProvidersEnabled()
  const keys = mocked ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  // Gemini rides the Google key Settings already holds for the LLM adapters,
  // which is why it wins when both keys exist: fal is the generator that
  // needs an account the user may not have. In mock mode the registry serves
  // the mock whichever id is asked for.
  const provider: ImageGenProviderId = keys.google ? 'google' : 'fal'
  const adapter = imageGenAdapter(provider)
  const apiKey = provider === 'google' ? keys.google : keys.fal

  const result = await withCost(
    db,
    {
      provider,
      operation: 'image.generate',
      projectId,
      estimateUsd: imageGenPrice(adapter, STILL_GENERATIONS),
      meta: { prompt: brief.prompt.slice(0, 200) },
    },
    async () => {
      const generated = await adapter.generate(
        {
          prompt: brief.prompt,
          ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
          count: STILL_GENERATIONS,
        },
        { ...(apiKey ? { apiKey } : {}) },
      )
      return { result: generated, actualUsd: generated.estimatedCostUsd }
    },
  )

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
          summary: `[mock] Generation ${index + 1} for: ${brief.prompt.slice(0, 120)}`,
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

      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: key,
        sourceUrl,
        licence: `Generated (${adapter.label})`,
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
        summary: `Generated from: ${brief.prompt.slice(0, 120)}`,
      } satisfies SlotCandidate
    }),
  )
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export async function scoreSlotCandidates(
  brief: StockBrief | ArchivalBrief,
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
      const candidates = await scoreSlotCandidates(
        brief,
        await fetchArchivalCandidates(brief),
        projectId,
      )
      return withChoice(candidates)
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

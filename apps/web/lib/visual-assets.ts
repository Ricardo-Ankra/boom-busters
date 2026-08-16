import 'server-only'

import { createHash } from 'node:crypto'
import { estimateImageGenUsd, withCost } from '@boom-busters/cost'
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
  mockProvidersEnabled,
  mockScores,
  parseScores,
  stockAdapter,
} from '@boom-busters/providers'
import type { StockQuery } from '@boom-busters/providers'
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
 *  - Still generation is paid (fal), so it runs inside `withCost` and a
 *    `BudgetExceededError` propagates up for the runner to park on.
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
    if (!keys.fal) {
      throw new ValidationError(
        'The shot list includes generated stills but fal.ai has no working key. Add it in ' +
          'Settings → Connections, then re-run the visuals stage.',
        { field: 'connections.fal' },
      )
    }
    if (!storageConfigured()) {
      throw new ValidationError(
        'Generated stills have nowhere to be stored — fal output URLs expire, so every image ' +
          'would be bought and then lost. Configure R2, or set MOCK_PROVIDERS=1.',
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
  const adapter = imageGenAdapter()
  const keys = mockProvidersEnabled() ? {} : await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)

  const result = await withCost(
    db,
    {
      provider: 'fal',
      operation: 'image.generate',
      projectId,
      estimateUsd: estimateImageGenUsd(STILL_GENERATIONS),
      meta: { prompt: brief.prompt.slice(0, 200) },
    },
    async () => {
      const generated = await adapter.generate(
        {
          prompt: brief.prompt,
          ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
          count: STILL_GENERATIONS,
        },
        { ...(keys.fal ? { apiKey: keys.fal } : {}) },
      )
      return { result: generated, actualUsd: generated.estimatedCostUsd }
    },
  )

  return Promise.all(
    result.images.map(async (image, index) => {
      // Mock generations arrive as data: URLs — displayable as-is, nothing to
      // download, no asset row. Real fal URLs expire, so the bytes are pulled
      // into R2 NOW and the asset row is the durable record.
      if (image.url.startsWith('data:')) {
        return {
          id: `fal-mock-${index + 1}`,
          provider: 'fal',
          kind: 'image',
          sourceUrl: image.url,
          thumbUrl: image.url,
          width: image.width,
          height: image.height,
          licence: '[mock] Generated',
          summary: `[mock] Generation ${index + 1} for: ${brief.prompt.slice(0, 120)}`,
        } satisfies SlotCandidate
      }

      const response = await fetch(image.url)
      if (!response.ok) {
        throw new Error(`fal image ${index + 1} could not be fetched (${response.status})`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      const contentHash = createHash('sha256').update(bytes).digest('hex')
      const { key } = await putObject(stillKey({ projectId, contentHash }), bytes, 'image/png')

      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: key,
        sourceUrl: image.url,
        licence: 'Generated (FLUX.1 dev via fal.ai)',
        contentHash,
        width: image.width,
        height: image.height,
      })

      return {
        id: `fal-${contentHash.slice(0, 12)}`,
        provider: 'fal',
        kind: 'image',
        sourceUrl: image.url,
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

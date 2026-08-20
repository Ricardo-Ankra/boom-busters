import 'server-only'

import { createHash } from 'node:crypto'
import { setSlotResolution, upsertAssetByHash, visualCredentials } from '@boom-busters/db'
import { LIVE_STOCK_ADAPTERS } from '@boom-busters/providers'
import { SlotCandidateSchema } from '@boom-busters/schemas'
import type { SlotCandidate } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { putObject, stockKey } from '@/lib/storage'

/**
 * Assembly-time stock ingestion — the missing half of the candidate
 * contract. `SlotCandidateSchema` has always said stock "is pulled into
 * storage by the render side in M6"; until this module, M6 instead wrote
 * the provider's download URL into the timeline as an `externalUrl`.
 * Pixabay's download URLs are session-signed and die within a day, so
 * every Pixabay shot in the first live preview was a broken image, and
 * the master render would have hit the same 400s (found 2026-08-19).
 *
 * So: for every resolved stock/archival slot whose chosen candidate has no
 * bytes in R2, download the source, store it content-hash keyed, record an
 * asset row, and write the key back into the candidate. When the stored URL
 * has already expired, the provider's `refetch` mints a fresh one from the
 * candidate's permanent id — same asset, new signature.
 *
 * Bytes DO stream through the app layer here, one slot per Inngest step —
 * the same trade `generateStillCandidates` already makes for fal output,
 * and `packages/providers/src/tts/audio.ts` documents for narration: until
 * a broker job exists for ingestion, there is nowhere else for the response
 * to go. A media-utils `ingest` job kind can replace the transport later
 * without changing what gets stored.
 */

/** One clip, not a boxset: past this size something is misconfigured. */
export const MAX_STOCK_BYTES = 200 * 1024 * 1024

/** The slot fields ingestion reads — matches `AssemblySlotRow`. */
export interface StockIngestSlot {
  id: string
  type: string
  status: string
  candidates: Record<string, unknown>[]
}

export type IngestOutcome =
  | { ok: true; r2Key: string; assetId?: string; previewR2Key?: string }
  | { ok: false; reason: string }

function chosenOf(slot: StockIngestSlot): SlotCandidate | null {
  const chosen = slot.candidates.find((candidate) => candidate['chosen'] === true)
  if (!chosen) return null
  const parsed = SlotCandidateSchema.safeParse(chosen)
  return parsed.success ? parsed.data : null
}

/**
 * Whether assembly owes this slot a download: resolved media slot, chosen
 * candidate, and either no bytes in R2 yet, or a video whose preview proxy
 * is still missing and obtainable. Pure — the runner uses it to decide
 * which slots get an ingest step at all.
 */
export function needsStockIngest(slot: StockIngestSlot): boolean {
  if (slot.type !== 'stock' && slot.type !== 'archival') return false
  if (slot.status !== 'resolved') return false
  const candidate = chosenOf(slot)
  if (!candidate) return false
  if (candidate.r2Key === undefined) return /^https?:\/\//.test(candidate.sourceUrl)
  return previewObtainable(candidate)
}

/** A video without a proxy, from a source that can still supply one. */
function previewObtainable(candidate: SlotCandidate): boolean {
  if (candidate.kind !== 'video' || candidate.previewR2Key !== undefined) return false
  return (
    candidate.previewSourceUrl !== undefined ||
    candidate.provider === 'pexels' ||
    candidate.provider === 'pixabay'
  )
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/** File extension for the stored key, from the content type or the URL. */
export function stockExtension(contentType: string | null, url: string): string {
  const mapped = contentType
    ? EXTENSIONS[contentType.split(';')[0]!.trim().toLowerCase()]
    : undefined
  if (mapped) return mapped
  const fromUrl = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(new URL(url).pathname)
  return fromUrl?.[1]?.toLowerCase() ?? 'bin'
}

export interface DownloadDeps {
  fetchImpl: typeof fetch
  /** Provider API keys, for minting a fresh URL when the stored one is dead. */
  keys: Partial<Record<'pexels' | 'pixabay', string>>
}

export type DownloadResult =
  | {
      ok: true
      bytes: Buffer
      contentType: string | null
      url: string
      /** A fresh preview-variant URL, when a refetch supplied one. */
      freshPreviewUrl?: string
    }
  | { ok: false; reason: string }

async function fetchBytes(
  url: string,
  fetchImpl: typeof fetch,
): Promise<
  { ok: true; bytes: Buffer; contentType: string | null } | { ok: false; status: number | string }
> {
  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) return { ok: false, status: response.status }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_STOCK_BYTES) {
    return { ok: false, status: `body of ${bytes.byteLength} bytes exceeds the ingest cap` }
  }
  return { ok: true, bytes, contentType: response.headers.get('content-type') }
}

/**
 * The candidate's bytes, from the stored URL or a freshly minted one.
 * No database, no storage — the testable middle of ingestion.
 */
export async function downloadStock(
  candidate: SlotCandidate,
  deps: DownloadDeps,
): Promise<DownloadResult> {
  const first = await fetchBytes(candidate.sourceUrl, deps.fetchImpl)
  if (first.ok) return { ...first, url: candidate.sourceUrl }

  // The stored URL is dead. Pexels and Pixabay ids are permanent even when
  // their download URLs are not — ask for a fresh one and try again.
  if (candidate.provider !== 'pexels' && candidate.provider !== 'pixabay') {
    return { ok: false, reason: `the source URL answered ${first.status} and cannot be re-minted` }
  }
  const apiKey = deps.keys[candidate.provider]
  if (!apiKey) {
    return {
      ok: false,
      reason:
        `the source URL answered ${first.status} and there is no ${candidate.provider} key in ` +
        'Settings → Connections to mint a fresh one with',
    }
  }

  // The LIVE adapter on purpose, never the registry's mock switch: minting
  // a fresh vendor URL is a live-vendor operation by definition, and the
  // runner already gates ingestion itself on mock mode.
  const adapter = LIVE_STOCK_ADAPTERS[candidate.provider]
  if (!adapter.refetch) {
    return { ok: false, reason: `the source URL answered ${first.status} and cannot be re-minted` }
  }
  const fresh = await adapter.refetch(
    { id: candidate.id, kind: candidate.kind },
    { apiKey, fetchImpl: deps.fetchImpl },
  )
  if (fresh === null) {
    return {
      ok: false,
      reason: `${candidate.provider} no longer offers this asset (id ${candidate.id})`,
    }
  }

  const second = await fetchBytes(fresh.sourceUrl, deps.fetchImpl)
  if (!second.ok) {
    return { ok: false, reason: `even a freshly minted URL answered ${second.status}` }
  }
  return {
    ...second,
    url: fresh.sourceUrl,
    ...(fresh.previewSourceUrl !== undefined ? { freshPreviewUrl: fresh.previewSourceUrl } : {}),
  }
}

/**
 * The preview proxy's bytes — best-effort, videos only. Tries the stored
 * variant URL, then a refetch-supplied fresh one, then one refetch of its
 * own. A miss is not a failure: the proxy is a smoothness optimisation and
 * the slot still previews (heavier) from the full clip.
 */
export async function downloadStockPreview(
  candidate: SlotCandidate,
  deps: DownloadDeps,
  freshPreviewUrl?: string,
): Promise<{ bytes: Buffer; contentType: string | null; url: string } | null> {
  const tried = new Set<string>()
  for (const url of [candidate.previewSourceUrl, freshPreviewUrl]) {
    if (url === undefined || tried.has(url)) continue
    tried.add(url)
    const result = await fetchBytes(url, deps.fetchImpl)
    if (result.ok) return { ...result, url }
  }

  if (freshPreviewUrl !== undefined) return null // the fresh one already failed
  if (candidate.provider !== 'pexels' && candidate.provider !== 'pixabay') return null
  const apiKey = deps.keys[candidate.provider]
  const adapter = LIVE_STOCK_ADAPTERS[candidate.provider]
  if (!apiKey || !adapter.refetch) return null
  const fresh = await adapter
    .refetch({ id: candidate.id, kind: candidate.kind }, { apiKey, fetchImpl: deps.fetchImpl })
    .catch(() => null)
  if (!fresh?.previewSourceUrl || tried.has(fresh.previewSourceUrl)) return null
  const result = await fetchBytes(fresh.previewSourceUrl, deps.fetchImpl)
  return result.ok ? { ...result, url: fresh.previewSourceUrl } : null
}

/** Hash-keyed store of one downloaded file; answers with the storage key. */
async function storeBytes(input: {
  bytes: Buffer
  contentType: string | null
  url: string
}): Promise<string> {
  const contentHash = createHash('sha256').update(input.bytes).digest('hex')
  const ext = stockExtension(input.contentType, input.url)
  const { key } = await putObject(
    stockKey({ contentHash, ext }),
    input.bytes,
    input.contentType ?? 'application/octet-stream',
  )
  return key
}

/**
 * Ingest one slot's chosen candidate: bytes into R2 (the full clip, plus a
 * small preview proxy for videos), an asset row, and the keys written back
 * into the slot's candidates jsonb — so a re-run, the board, and every
 * later timeline version all see the stored copies. A slot that already
 * holds its full clip gets a preview-only pass; a preview that cannot be
 * fetched never fails the slot, because the proxy is an optimisation.
 */
export async function ingestSlotStock(slot: StockIngestSlot): Promise<IngestOutcome> {
  const candidate = chosenOf(slot)
  if (!candidate) return { ok: false, reason: 'no chosen candidate to ingest' }
  const needsPrimary = candidate.r2Key === undefined
  if (!needsPrimary && !previewObtainable(candidate)) {
    return { ok: false, reason: 'already ingested — nothing to do' }
  }

  const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
  const deps: DownloadDeps = {
    fetchImpl: fetch,
    keys: {
      ...(keys.pexels ? { pexels: keys.pexels } : {}),
      ...(keys.pixabay ? { pixabay: keys.pixabay } : {}),
    },
  }

  let r2Key = candidate.r2Key
  let assetId = candidate.assetId
  let freshPreviewUrl: string | undefined

  if (needsPrimary) {
    const downloaded = await downloadStock(candidate, deps)
    if (!downloaded.ok) return downloaded
    freshPreviewUrl = downloaded.freshPreviewUrl
    r2Key = await storeBytes(downloaded)

    const asset = await upsertAssetByHash(db, {
      kind: candidate.kind,
      r2Key,
      // Provenance: the human-facing page outlives any signed download URL.
      sourceUrl: candidate.pageUrl ?? candidate.sourceUrl,
      licence: candidate.licence,
      contentHash: createHash('sha256').update(downloaded.bytes).digest('hex'),
      ...(candidate.width !== undefined ? { width: candidate.width } : {}),
      ...(candidate.height !== undefined ? { height: candidate.height } : {}),
      ...(candidate.durationMs !== undefined ? { durationMs: candidate.durationMs } : {}),
      ...(candidate.attributionText !== undefined
        ? { attributionText: candidate.attributionText }
        : {}),
    })
    assetId = asset.id
  }

  let previewR2Key = candidate.previewR2Key
  if (previewObtainable(candidate)) {
    const preview = await downloadStockPreview(candidate, deps, freshPreviewUrl)
    if (preview) previewR2Key = await storeBytes(preview)
  }

  const gained = r2Key !== candidate.r2Key || previewR2Key !== candidate.previewR2Key
  if (gained) {
    const updated = slot.candidates.map((entry) =>
      entry['chosen'] === true
        ? {
            ...entry,
            r2Key,
            ...(assetId !== undefined ? { assetId } : {}),
            ...(previewR2Key !== undefined ? { previewR2Key } : {}),
          }
        : entry,
    )
    await setSlotResolution(db, slot.id, {
      candidates: updated as unknown as SlotCandidate[],
      status: 'resolved',
      chosenAssetId: assetId ?? null,
    })
  }

  return {
    ok: true,
    r2Key: r2Key!,
    ...(assetId !== undefined ? { assetId } : {}),
    ...(previewR2Key !== undefined ? { previewR2Key } : {}),
  }
}

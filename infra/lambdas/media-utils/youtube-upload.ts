/**
 * The chunked half of the YouTube resumable upload (spec section 9), with the
 * object store and the network passed in so it is tested without either.
 *
 * It reads the video one chunk at a time. Reading it whole (`transformToByteArray`)
 * worked for a 15-minute master of a few hundred megabytes and cannot work for a
 * 240-minute one: that file is several gigabytes, and this Lambda holds 3,008 MB.
 *
 * An invocation lasts at most 15 minutes and a 180-minute master is about 8 GB,
 * so one invocation cannot always finish. The loop stops before the limit and
 * reports where it got to; a later invocation continues on the same session.
 */

import type { UploadYoutubeResult } from '@boom-busters/schemas'

/** 8 MB, a multiple of the 256 KB YouTube asks for. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024

export async function putInChunks(input: {
  total: number
  uploadUrl: string
  fetchImpl: typeof fetch
  /** Bytes `start` to `endInclusive` of the video, read from the store. */
  readRange: (start: number, endInclusive: number) => Promise<Uint8Array>
  chunkBytes?: number
  /** Where to continue a session from; 0 for a fresh one. */
  startOffset?: number
  /** Epoch ms after which no new chunk is started. No deadline when absent. */
  deadlineAt?: number
  now?: () => number
}): Promise<UploadYoutubeResult> {
  const chunkBytes = input.chunkBytes ?? YOUTUBE_CHUNK_BYTES
  const now = input.now ?? Date.now
  let offset = input.startOffset ?? 0
  for (;;) {
    if (input.deadlineAt !== undefined && now() >= input.deadlineAt) {
      return { status: 'in-progress', uploadUrl: input.uploadUrl, offset, total: input.total }
    }
    const end = Math.min(offset + chunkBytes, input.total)
    const chunk = await input.readRange(offset, end - 1)
    if (chunk.length !== end - offset) {
      throw new Error(
        `video read returned ${chunk.length} bytes for bytes ${offset}-${end - 1} (expected ${end - offset})`,
      )
    }
    const response = await input.fetchImpl(input.uploadUrl, {
      method: 'PUT',
      headers: {
        'content-length': String(chunk.length),
        'content-range': `bytes ${offset}-${end - 1}/${input.total}`,
      },
      body: chunk,
    })
    if (response.status === 308) {
      const range = response.headers.get('range')
      offset = range ? Number(range.split('-')[1]) + 1 : end
      continue
    }
    if (response.ok) {
      const uploaded = (await response.json()) as {
        id?: string
        status?: { uploadStatus?: string }
      }
      return {
        videoId: uploaded.id ?? 'unknown',
        status: uploaded.status?.uploadStatus ?? 'uploaded',
      }
    }
    throw new Error(`youtube upload failed with ${response.status}`)
  }
}

/**
 * Asks YouTube how much of a session it holds: an empty PUT with
 * a star range of the total length. 308 carries `Range: bytes=0-N` (N + 1 bytes
 * stored, none when absent); 200 or 201 means the upload already finished.
 */
export async function querySessionOffset(input: {
  uploadUrl: string
  total: number
  fetchImpl: typeof fetch
}): Promise<
  { kind: 'offset'; offset: number } | { kind: 'done'; videoId: string; status: string }
> {
  const response = await input.fetchImpl(input.uploadUrl, {
    method: 'PUT',
    headers: { 'content-length': '0', 'content-range': `bytes */${input.total}` },
  })
  if (response.status === 308) {
    const range = response.headers.get('range')
    return { kind: 'offset', offset: range ? Number(range.split('-')[1]) + 1 : 0 }
  }
  if (response.status === 200 || response.status === 201) {
    const uploaded = (await response.json()) as {
      id?: string
      status?: { uploadStatus?: string }
    }
    return {
      kind: 'done',
      videoId: uploaded.id ?? 'unknown',
      status: uploaded.status?.uploadStatus ?? 'uploaded',
    }
  }
  throw new Error(`youtube session status ${response.status}`)
}

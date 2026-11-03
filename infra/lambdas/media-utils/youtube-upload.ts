/**
 * The chunked half of the YouTube resumable upload (spec section 9), with the
 * object store and the network passed in so it is tested without either.
 *
 * It reads the video one chunk at a time. Reading it whole (`transformToByteArray`)
 * worked for a 15-minute master of a few hundred megabytes and cannot work for a
 * 240-minute one: that file is several gigabytes, and this Lambda holds 3,008 MB.
 */

/** 8 MB, a multiple of the 256 KB YouTube asks for. */
export const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024

export async function putInChunks(input: {
  total: number
  uploadUrl: string
  fetchImpl: typeof fetch
  /** Bytes `start` to `endInclusive` of the video, read from the store. */
  readRange: (start: number, endInclusive: number) => Promise<Uint8Array>
  chunkBytes?: number
}): Promise<{ videoId: string; status: string }> {
  const chunkBytes = input.chunkBytes ?? YOUTUBE_CHUNK_BYTES
  let offset = 0
  for (;;) {
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

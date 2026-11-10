import type { Readable } from 'node:stream'

/** S3 needs 5 MiB for every part but the last; 64 MiB keeps a film under 10 000 parts. */
export const MULTIPART_PART_BYTES = 64 * 1024 * 1024

/**
 * Stream a readable into an S3 multipart upload without holding more than one
 * part in memory. The four S3 operations are injected so this is tested with
 * fakes. Any failure aborts the upload (leaving no object and no billed parts)
 * and rethrows; an empty stream has nothing to upload and is a failure too.
 */
export interface UploadedPart {
  partNumber: number
  etag: string
  /** The part's CRC32 as S3 returned it; completing the upload hands it back. */
  checksumCrc32?: string
}

export async function uploadStreamMultipart(input: {
  stream: Readable
  partBytes?: number
  create: () => Promise<string>
  uploadPart: (
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ) => Promise<{ etag: string; checksumCrc32?: string }>
  complete: (uploadId: string, parts: UploadedPart[]) => Promise<void>
  abort: (uploadId: string) => Promise<void>
}): Promise<{ bytes: number; parts: number }> {
  const partBytes = input.partBytes ?? MULTIPART_PART_BYTES
  const uploadId = await input.create()
  const parts: UploadedPart[] = []
  let bytes = 0
  try {
    let pending: Buffer[] = []
    let pendingBytes = 0
    const send = async (body: Buffer): Promise<void> => {
      const partNumber = parts.length + 1
      const uploaded = await input.uploadPart(uploadId, partNumber, body)
      parts.push({
        partNumber,
        etag: uploaded.etag,
        ...(uploaded.checksumCrc32 ? { checksumCrc32: uploaded.checksumCrc32 } : {}),
      })
      bytes += body.length
    }
    // Async iteration rejects on a stream 'error' event, and awaiting each
    // part before reading on gives back-pressure while a part uploads.
    for await (const chunk of input.stream as AsyncIterable<Buffer | string>) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      pending.push(buffer)
      pendingBytes += buffer.length
      while (pendingBytes >= partBytes) {
        const all = Buffer.concat(pending, pendingBytes)
        pending = [all.subarray(partBytes)]
        pendingBytes = all.length - partBytes
        await send(all.subarray(0, partBytes))
      }
    }
    if (pendingBytes > 0) await send(Buffer.concat(pending, pendingBytes))
    if (parts.length === 0) throw new Error('nothing to upload: the stream was empty')
    await input.complete(uploadId, parts)
    return { bytes, parts: parts.length }
  } catch (error) {
    // A failed abort leaves billed parts behind, so say so before rethrowing the real error.
    await input.abort(uploadId).catch((abortError: unknown) => {
      console.error(
        JSON.stringify({ event: 'multipart-abort-failed', uploadId, message: String(abortError) }),
      )
    })
    throw error
  }
}

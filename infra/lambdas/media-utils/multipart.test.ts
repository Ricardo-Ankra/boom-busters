import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { uploadStreamMultipart } from './multipart'

type UploadResult = { etag: string; checksumCrc32?: string }

function fakes() {
  const bodies: number[] = []
  return {
    bodies,
    create: vi.fn(async () => 'up-1'),
    uploadPart: vi.fn(async (_id: string, n: number, body: Buffer): Promise<UploadResult> => {
      bodies.push(body.length)
      return { etag: `etag-${n}`, checksumCrc32: `crc-${n}` }
    }),
    complete: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  }
}

describe('uploadStreamMultipart', () => {
  it('uploads in parts of the given size, the last one short, and completes in order', async () => {
    const f = fakes()
    const stream = Readable.from([Buffer.alloc(3), Buffer.alloc(5), Buffer.alloc(2)])
    const result = await uploadStreamMultipart({ stream, partBytes: 4, ...f })
    expect(f.bodies).toEqual([4, 4, 2])
    expect(f.complete).toHaveBeenCalledWith('up-1', [
      { partNumber: 1, etag: 'etag-1', checksumCrc32: 'crc-1' },
      { partNumber: 2, etag: 'etag-2', checksumCrc32: 'crc-2' },
      { partNumber: 3, etag: 'etag-3', checksumCrc32: 'crc-3' },
    ])
    expect(f.abort).not.toHaveBeenCalled()
    expect(result).toEqual({ bytes: 10, parts: 3 })
  })

  it('hands complete no checksum for a part S3 returned none for', async () => {
    const f = fakes()
    f.uploadPart.mockResolvedValueOnce({ etag: 'etag-1' })
    const stream = Readable.from([Buffer.alloc(6)])
    await uploadStreamMultipart({ stream, partBytes: 4, ...f })
    expect(f.complete).toHaveBeenCalledWith('up-1', [
      { partNumber: 1, etag: 'etag-1' },
      { partNumber: 2, etag: 'etag-2', checksumCrc32: 'crc-2' },
    ])
  })

  it('aborts and rethrows when a part upload fails', async () => {
    const f = fakes()
    f.uploadPart.mockRejectedValueOnce(new Error('boom'))
    const stream = Readable.from([Buffer.alloc(10)])
    await expect(uploadStreamMultipart({ stream, partBytes: 4, ...f })).rejects.toThrow('boom')
    expect(f.abort).toHaveBeenCalledWith('up-1')
    expect(f.complete).not.toHaveBeenCalled()
  })

  it('aborts when the stream errors', async () => {
    const f = fakes()
    const stream = new Readable({ read() {} })
    stream.push(Buffer.alloc(6))
    setTimeout(() => stream.destroy(new Error('pipe broke')), 5)
    await expect(uploadStreamMultipart({ stream, partBytes: 4, ...f })).rejects.toThrow(
      'pipe broke',
    )
    expect(f.abort).toHaveBeenCalledWith('up-1')
    expect(f.complete).not.toHaveBeenCalled()
  })

  it('aborts when complete rejects', async () => {
    const f = fakes()
    f.complete.mockRejectedValueOnce(new Error('ffmpeg exited 1'))
    const stream = Readable.from([Buffer.alloc(6)])
    await expect(uploadStreamMultipart({ stream, partBytes: 4, ...f })).rejects.toThrow(
      'ffmpeg exited 1',
    )
    expect(f.abort).toHaveBeenCalledWith('up-1')
  })

  it('aborts and rejects an empty stream', async () => {
    const f = fakes()
    await expect(
      uploadStreamMultipart({ stream: Readable.from([]), partBytes: 4, ...f }),
    ).rejects.toThrow(/empty/)
    expect(f.abort).toHaveBeenCalledWith('up-1')
  })
})

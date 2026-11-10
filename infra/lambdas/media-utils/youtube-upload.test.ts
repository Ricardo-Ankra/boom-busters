import { describe, expect, it } from 'vitest'
import { YOUTUBE_CHUNK_BYTES, putInChunks, querySessionOffset } from './youtube-upload'

/**
 * A 240-minute master is several gigabytes (at 4 Mbps, 7.2 GB; the media-utils
 * Lambda holds 3,008 MB). The upload must therefore read the video a chunk at
 * a time and never hold the object whole.
 */
const GIB = 1024 * 1024 * 1024
const SHARED = new Uint8Array(YOUTUBE_CHUNK_BYTES)

function fakeYoutube(total: number) {
  const puts: { range: string; length: number }[] = []
  let received = 0
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const body = init.body as Uint8Array
    puts.push({ range: headers['content-range']!, length: body.length })
    received += body.length
    if (received < total) {
      return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } })
    }
    return new Response(JSON.stringify({ id: 'vid123', status: { uploadStatus: 'uploaded' } }), {
      status: 200,
    })
  }) as unknown as typeof fetch
  return { fetchImpl, puts }
}

describe('putInChunks', () => {
  it('uploads a 7 GiB master without ever reading more than one chunk', async () => {
    const total = 7 * GIB
    const { fetchImpl, puts } = fakeYoutube(total)
    const reads: number[] = []
    const result = await putInChunks({
      total,
      uploadUrl: 'https://upload.example/session',
      fetchImpl,
      readRange: async (start, endInclusive) => {
        reads.push(endInclusive - start + 1)
        return SHARED.subarray(0, endInclusive - start + 1)
      },
    })
    expect(result).toEqual({ videoId: 'vid123', status: 'uploaded' })
    expect(Math.max(...reads)).toBeLessThanOrEqual(YOUTUBE_CHUNK_BYTES)
    expect(puts).toHaveLength(Math.ceil(total / YOUTUBE_CHUNK_BYTES))
    expect(puts[0]!.range).toBe(`bytes 0-${YOUTUBE_CHUNK_BYTES - 1}/${total}`)
    expect(puts.at(-1)!.range.endsWith(`-${total - 1}/${total}`)).toBe(true)
  })

  it('resumes from where YouTube says it has got to', async () => {
    const total = 3 * 256 * 1024
    const starts: number[] = []
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      // First chunk is only half taken; then everything.
      if (calls === 1)
        return new Response(null, { status: 308, headers: { range: 'bytes=0-262143' } })
      return new Response(JSON.stringify({ id: 'v' }), { status: 200 })
    }) as unknown as typeof fetch
    await putInChunks({
      total,
      uploadUrl: 'https://upload.example/session',
      fetchImpl,
      chunkBytes: total,
      readRange: async (start, endInclusive) => {
        starts.push(start)
        return new Uint8Array(endInclusive - start + 1)
      },
    })
    expect(starts).toEqual([0, 262144])
  })

  it('fails honestly on a refusal', async () => {
    const fetchImpl = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch
    await expect(
      putInChunks({
        total: 10,
        uploadUrl: 'https://upload.example/session',
        fetchImpl,
        readRange: async (s, e) => new Uint8Array(e - s + 1),
      }),
    ).rejects.toThrow('youtube upload failed with 403')
  })

  it('fails clearly when a ranged read comes back short', async () => {
    const fetchImpl = (async () => new Response('x', { status: 200 })) as unknown as typeof fetch
    await expect(
      putInChunks({
        total: 100,
        uploadUrl: 'https://upload.example/session',
        fetchImpl,
        readRange: async () => new Uint8Array(10),
      }),
    ).rejects.toThrow('video read returned 10 bytes for bytes 0-99 (expected 100)')
  })

  it('stops at the deadline and reports where it got to', async () => {
    const chunk = 256 * 1024
    const total = 3 * chunk
    const { fetchImpl, puts } = fakeYoutube(total)
    let clock = 0
    const result = await putInChunks({
      total,
      uploadUrl: 'https://upload.example/session',
      fetchImpl,
      chunkBytes: chunk,
      deadlineAt: 1000,
      // The clock passes the deadline once the first chunk is in.
      now: () => clock,
      readRange: async (start, endInclusive) => {
        clock = 2000
        return new Uint8Array(endInclusive - start + 1)
      },
    })
    expect(result).toEqual({
      status: 'in-progress',
      uploadUrl: 'https://upload.example/session',
      offset: chunk,
      total,
    })
    expect(puts).toHaveLength(1)
  })

  it('resumes from the given offset', async () => {
    const chunk = 256 * 1024
    const total = 3 * chunk
    const { fetchImpl, puts } = fakeYoutube(total)
    const result = await putInChunks({
      total,
      uploadUrl: 'https://upload.example/session',
      fetchImpl,
      chunkBytes: chunk,
      startOffset: chunk,
      readRange: async (start, endInclusive) => new Uint8Array(endInclusive - start + 1),
    })
    expect(puts[0]!.range).toBe(`bytes ${chunk}-${2 * chunk - 1}/${total}`)
    expect(result).toMatchObject({ status: 'uploaded' })
  })
})

describe('querySessionOffset', () => {
  it('reads the session offset from a 308 range and a finished session from a 200', async () => {
    const answer = (response: Response) =>
      querySessionOffset({
        uploadUrl: 'https://upload.example/session',
        total: 1000,
        fetchImpl: (async () => response) as unknown as typeof fetch,
      })
    expect(
      await answer(new Response(null, { status: 308, headers: { range: 'bytes=0-524287' } })),
    ).toEqual({ kind: 'offset', offset: 524288 })
    expect(await answer(new Response(null, { status: 308 }))).toEqual({ kind: 'offset', offset: 0 })
    expect(
      await answer(
        new Response(JSON.stringify({ id: 'vid9', status: { uploadStatus: 'processed' } }), {
          status: 200,
        }),
      ),
    ).toEqual({ kind: 'done', videoId: 'vid9', status: 'processed' })
    await expect(answer(new Response('no', { status: 404 }))).rejects.toThrow(
      'youtube session status 404',
    )
  })
})

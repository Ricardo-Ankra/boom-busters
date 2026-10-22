import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { liveTranscripts } from './transcript'
import { mockTranscripts } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function setup(
  page: string,
  captions: Response | Error = new Response(fixture('youtube-captions.json3')),
) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url).includes('/watch?')) return new Response(page)
    if (captions instanceof Error) throw captions
    return captions
  })
  return {
    fetchImpl,
    source: liveTranscripts({ fetchImpl, contact: 'me@example.com' }),
  }
}

describe('liveTranscripts', () => {
  it('reads the caption track out of the watch page and maps json3 events', async () => {
    const { source, fetchImpl } = setup(fixture('youtube-player-captions.html'))
    expect(await source.fetch('abc123')).toEqual([
      { start: 0, text: 'Welcome back' },
      { start: 5.25, text: 'The company collapsed in 2020.' },
    ])
    const calls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(calls[0]).toBe('https://www.youtube.com/watch?v=abc123')
    // The manual en-GB track beats the auto-generated en one.
    expect(calls[1]).toBe('https://www.youtube.com/api/timedtext?v=abc123&lang=en&fmt=json3')
    const init = fetchImpl.mock.calls[0]![1]
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe(
      'boom-busters-case-finder/1.0 (+me@example.com)',
    )
  })

  it('returns null for a page without caption tracks', async () => {
    const { source } = setup(fixture('youtube-player-no-captions.html'))
    expect(await source.fetch('abc123')).toBeNull()
  })

  it('returns null on a bad caption body, a non-2xx reply or a thrown fetch', async () => {
    const page = fixture('youtube-player-captions.html')
    expect(await setup(page, new Response('not json')).source.fetch('x')).toBeNull()
    expect(await setup(page, new Response('', { status: 429 })).source.fetch('x')).toBeNull()
    expect(await setup(page, new TypeError('offline')).source.fetch('x')).toBeNull()
    expect(await setup('"captionTracks":[{broken').source.fetch('x')).toBeNull()
  })
})

describe('mockTranscripts', () => {
  it('returns five fixed segments for any id', async () => {
    const segments = await mockTranscripts.fetch('anything')
    expect(segments?.map((s) => s.start)).toEqual([0, 5, 9, 14, 20])
  })
})

import { describe, expect, it, vi } from 'vitest'
import { socialProvider } from './index'
import { liveSocialProvider, X_OEMBED_ENDPOINT, X_POST_MISSING, X_UNREACHABLE } from './fetch'
import { OEMBED_JACK } from './fixtures'

const POST_URL = 'https://x.com/jack/status/20'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function status(code: number): Response {
  return new Response(null, { status: code })
}

function read(fetchImpl: typeof fetch, url = POST_URL) {
  return liveSocialProvider.fetchPost(url, { fetchImpl })
}

describe('the social fetch', () => {
  it('reads a post and asks for the script-free embed', async () => {
    const call = vi.fn(() => Promise.resolve(jsonResponse(OEMBED_JACK)))
    const post = await read(call as unknown as typeof fetch)

    expect(post.text).toBe('just setting up my twttr')
    expect(post.postedAt).toBe('2006-03-21')
    const [url] = call.mock.calls[0] as unknown as [string]
    expect(url.startsWith(X_OEMBED_ENDPOINT)).toBe(true)
    expect(url).toContain('omit_script=1')
  })

  it('refuses a post that does not exist, without retrying', async () => {
    const call = vi.fn(() => Promise.resolve(status(404)))
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(X_POST_MISSING)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('refuses a protected post the same way', async () => {
    const call = vi.fn(() => Promise.resolve(status(403)))
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(X_POST_MISSING)
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('retries once after a bad minute, and succeeds on the second try', async () => {
    let attempt = 0
    const call = vi.fn(() => {
      attempt += 1
      return Promise.resolve(attempt === 1 ? status(500) : jsonResponse(OEMBED_JACK))
    })
    const post = await read(call as unknown as typeof fetch)
    expect(post.text).toBe('just setting up my twttr')
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('gives up after two failures', async () => {
    const call = vi.fn(() => Promise.resolve(status(500)))
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(X_UNREACHABLE)
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('refuses a body that is not JSON', async () => {
    const call = vi.fn(() =>
      Promise.resolve(
        new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    )
    await expect(read(call as unknown as typeof fetch)).rejects.toThrow(X_UNREACHABLE)
  })
})

describe('the mock provider', () => {
  it('answers without opening a socket', async () => {
    const provider = socialProvider({ MOCK_PROVIDERS: '1' })
    const call = vi.fn()
    const post = await provider.fetchPost(POST_URL, { fetchImpl: call as unknown as typeof fetch })
    expect(call).not.toHaveBeenCalled()
    expect(post.handle).not.toBeNull()
  })

  it('is not selected unless the flag says so', () => {
    expect(socialProvider({})).toBe(liveSocialProvider)
  })
})

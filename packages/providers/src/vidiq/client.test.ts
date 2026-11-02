import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isRetriable, ValidationError } from '@boom-busters/schemas'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { clientOver, createVidiqClient, VidiqError } from './client'
import { KEYWORD_RESEARCH_MARKDOWN } from './fixtures/keyword-research'
import { VIDIQ_CREDIT_COST } from './costs'
import { mockVidiqClient } from './mock'

describe('the VidIQ mock client', () => {
  it('parses every fixture into its shape, nulls kept', async () => {
    const c = mockVidiqClient()
    expect((await c.balance()).totalCredits).toBe(1443)
    expect((await c.channelVideos('@boom-busters')).data.length).toBeGreaterThan(0)
    const outliers = await c.outliers({ keyword: 'x' })
    expect(outliers).toEqual({
      data: expect.any(Array),
      credits: 5,
      args: { keyword: 'x', limit: 20 },
    })
    const details = (await c.getVideosByIds(['x'])).data
    expect(details.some((v) => v.tags === null || Array.isArray(v.tags))).toBe(true)
    expect((await c.videoTranscript({ videoId: 'x' })).data.segments.length).toBeGreaterThan(1)
    const keywords = await c.keywordResearch('wework')
    expect(keywords.data[0]).toEqual(expect.objectContaining({ keyword: expect.any(String) }))
    expect(keywords.credits).toBe(VIDIQ_CREDIT_COST.keywordResearch)
    expect((await c.scoreTitle('How WeWork Lost $47 Billion')).data).toEqual({ score: 80 })
  })
})

describe('the live VidIQ client', () => {
  it('is constructed and closed without opening a connection', async () => {
    const c = createVidiqClient('key', { endpoint: 'http://127.0.0.1:9/mcp' })
    expect(typeof c.balance).toBe('function')
    await c.close()
  })
})

describe('the embedded keyword fixture', () => {
  it('is byte-identical to the recorded markdown', () => {
    const recorded = readFileSync(
      new URL('./fixtures/keyword_research.md', import.meta.url),
      'utf8',
    )
    expect(KEYWORD_RESEARCH_MARKDOWN).toBe(recorded)
  })
})

describe('what each call reports it sent', () => {
  it('carries the wire arguments, not the method arguments', async () => {
    const c = mockVidiqClient()
    expect((await c.channelVideos('@boom-busters')).args).toEqual({
      channelId: '@boom-busters',
      videoFormat: 'long',
      popular: true,
    })
    expect((await c.getVideosByIds(['a', 'b'])).args).toEqual({ videoIds: ['a', 'b'] })
    expect((await c.videoTranscript({ videoId: 'v', language: 'en' })).args).toEqual({
      videoId: 'v',
      language: 'en',
    })
  })
})

describe('a refused key', () => {
  const never = async () => {}
  const failing = (error: unknown) => clientOver(async () => Promise.reject(error), never)

  it('is a non-retriable validation error for an HTTP 401 or 403 from the transport', async () => {
    for (const code of [401, 403]) {
      const error = await failing(new StreamableHTTPError(code, 'nope'))
        .balance()
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ValidationError)
      expect(isRetriable(error)).toBe(false)
      expect((error as Error).message).toMatch(/refused/i)
    }
  })

  it('is a validation error when an MCP error result says unauthorised', async () => {
    const c = clientOver(
      async () => ({ isError: true, content: [{ type: 'text', text: 'Unauthorized: bad key' }] }),
      never,
    )
    const error = await c.balance().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(isRetriable(error)).toBe(false)
  })

  it('keeps a Forbidden error result from another tool a VidiqError', async () => {
    const c = clientOver(
      async () => ({
        isError: true,
        content: [{ type: 'text', text: 'Forbidden: captions not available for this video' }],
      }),
      never,
    )
    const error = await c.videoTranscript({ videoId: 'abc' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VidiqError)
    expect(error).not.toBeInstanceOf(ValidationError)
  })

  it('names Settings, Connections in the refusal', async () => {
    const error = await failing(new StreamableHTTPError(401, 'nope'))
      .balance()
      .catch((e: unknown) => e)
    expect((error as Error).message).toContain('Settings, Connections')
  })

  it('leaves a network failure retriable', async () => {
    const error = await failing(new VidiqError('vidiq_balance', 'fetch failed'))
      .balance()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(VidiqError)
    expect(isRetriable(error)).toBe(true)
  })
})

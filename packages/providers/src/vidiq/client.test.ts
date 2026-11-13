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
    expect((await c.scoreTitle({ title: 'How WeWork Lost $47 Billion' })).data).toEqual({
      score: 80,
    })
  })
})

describe('the widened VidIQ calls', () => {
  it('sends the questions mode with its limit and parses the questions table', async () => {
    const call = await mockVidiqClient().keywordResearch('wework', { mode: 'questions', limit: 10 })
    expect(call.args).toEqual({ keyword: 'wework', mode: 'questions', limit: 10 })
    expect(call.data.length).toBeGreaterThan(3)
    expect(call.data.every((row) => /^(why|how|what|did|is|who|was) /.test(row.keyword))).toBe(true)
    expect(call.data[0]?.estimatedMonthlySearch).toEqual(expect.any(Number))
  })

  it('measures one phrase in research mode, sending includeRelated only when given (decision 468)', async () => {
    const call = await mockVidiqClient().keywordResearch('Ueno Bank  Paraguay', {
      mode: 'research',
      includeRelated: false,
      limit: 1,
    })
    expect(call.args).toEqual({
      keyword: 'Ueno Bank  Paraguay',
      mode: 'research',
      limit: 1,
      includeRelated: false,
    })
    expect(call.data).toEqual([
      {
        keyword: 'ueno bank paraguay',
        volume: 66,
        competition: 30,
        overall: 68,
        estimatedMonthlySearch: 24000,
        growthPct: null,
      },
    ])
    expect(call.credits).toBe(VIDIQ_CREDIT_COST.keywordResearch)
  })

  it('keeps the default keyword call as it was', async () => {
    const call = await mockVidiqClient().keywordResearch('wework')
    expect(call.args).toEqual({ keyword: 'wework', mode: 'matching_terms', limit: 8 })
    const row = call.data.find((r) => r.keyword === 'wework documentary')
    expect(row?.estimatedMonthlySearch).toBe(18355)
    expect(row?.growthPct).toBe(-39.1)
    expect(call.data.find((r) => r.keyword === 'wework rise and fall')?.growthPct).toBeNull()
  })

  it('sends each new outlier filter only when given', async () => {
    const c = mockVidiqClient()
    expect(
      (
        await c.outliers({
          keyword: 'wework',
          requireAllTitleTerms: true,
          publishedWithin: 'allTime',
          limit: 25,
        })
      ).args,
    ).toEqual({
      keyword: 'wework',
      limit: 25,
      requireAllTitleTerms: true,
      publishedWithin: 'allTime',
    })
    expect((await c.outliers({ keyword: 'x' })).args).toEqual({ keyword: 'x', limit: 20 })
  })

  it('carries the channel subscribers on each outlier', async () => {
    const { data } = await mockVidiqClient().outliers({ keyword: 'x' })
    expect(data.map((v) => v.subscribers)).toEqual([15600, 1000, 64600, 1700, 8900])
  })

  it('scores a title as long by default and sends the channel only when given', async () => {
    const c = mockVidiqClient()
    expect((await c.scoreTitle({ title: 'x', channelId: 'UCzg' })).args).toEqual({
      title: 'x',
      type: 'long',
      channelId: 'UCzg',
    })
    expect((await c.scoreTitle({ title: 'x' })).args).toEqual({ title: 'x', type: 'long' })
    expect((await c.scoreTitle({ title: 'x', type: 'short' })).args).toEqual({
      title: 'x',
      type: 'short',
    })
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

describe('search, comments and the niche test', () => {
  it('serves the new fixtures in mock mode and reports the wire arguments', async () => {
    const c = mockVidiqClient()
    const search = await c.youtubeSearch('wework documentary')
    expect(search.args).toEqual({
      query: 'wework documentary',
      type: ['video'],
      limit: 10,
      order: 'relevance',
    })
    expect(search.credits).toBe(5)
    expect(search.data.length).toBe(5)

    const comments = await c.videoComments('c9Xm1bT50DQ')
    expect(comments.args).toEqual({ videoId: 'c9Xm1bT50DQ', order: 'relevance', maxResult: 100 })
    expect(comments.credits).toBe(5)
    expect(comments.data.length).toBe(5)

    const job = await c.commentInsightsValidate({
      niche: 'business collapses',
      idea: 'WeWork',
      language: 'pt-BR',
    })
    expect(job.data).toEqual({ jobId: 'job_fixture_0001' })
    expect(job.args).toEqual({
      mode: 'validate',
      niche: 'business collapses',
      idea: 'WeWork',
      language: 'pt',
    })
    expect(job.credits).toBe(VIDIQ_CREDIT_COST.commentInsights)

    const polled = await c.jobPoll('job_fixture_0001')
    expect(polled.args).toEqual({ mcpJobId: 'job_fixture_0001' })
    expect(polled.credits).toBe(0)
    expect(polled.data.status).toBe('completed')
  })

  it('omits an empty language and keeps the costs', async () => {
    const c = mockVidiqClient()
    expect((await c.commentInsightsValidate({ niche: 'n', idea: 'i' })).args).toEqual({
      mode: 'validate',
      niche: 'n',
      idea: 'i',
    })
    expect((await c.commentInsightsValidate({ niche: 'n', idea: 'i', language: '' })).args).toEqual(
      {
        mode: 'validate',
        niche: 'n',
        idea: 'i',
      },
    )
    expect(VIDIQ_CREDIT_COST).toEqual(
      expect.objectContaining({
        youtubeSearch: 5,
        videoComments: 5,
        commentInsights: 5,
        jobPoll: 0,
      }),
    )
  })
})

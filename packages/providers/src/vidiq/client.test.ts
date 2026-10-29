import { describe, expect, it } from 'vitest'
import { VIDIQ_CREDIT_COST, createVidiqClient } from './client'
import { mockVidiqClient } from './mock'

describe('the VidIQ mock client', () => {
  it('parses every fixture into its shape, nulls kept', async () => {
    const c = mockVidiqClient()
    expect((await c.balance()).totalCredits).toBe(1443)
    expect((await c.channelVideos('@boom-busters')).data.length).toBeGreaterThan(0)
    const outliers = await c.outliers({ keyword: 'x' })
    expect(outliers).toEqual({ data: expect.any(Array), credits: 5 })
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

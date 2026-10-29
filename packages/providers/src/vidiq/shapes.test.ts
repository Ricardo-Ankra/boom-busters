import { describe, expect, it } from 'vitest'
import balance from './fixtures/balance.json'
import channelVideos from './fixtures/channel_videos.json'
import outliers from './fixtures/outliers.json'
import transcript from './fixtures/video_transcript.json'
import {
  VidiqError,
  parseBalance,
  parseChannelVideos,
  parseKeywordTable,
  parseOutliers,
  parseTranscript,
  parseVidiqResult,
} from './shapes'

describe('the VidIQ parsers', () => {
  it('reads outliers out of the markdown answer', () => {
    const videos = parseOutliers(outliers)
    expect(videos.map((v) => v.videoId)).toEqual([
      'TZIC1sL9XTk',
      'JH89RGzulEE',
      'In8GehBC25c',
      '_-fSkbERuYI',
      '_d1ntT462Ac',
    ])
    expect(videos[1]?.channelId).toBe('UCWXh6rJ5ZyiXA1F40_sPwyA')
    expect(videos[0]).toEqual({
      videoId: 'TZIC1sL9XTk',
      title: 'How GM Destroyed Itself — A Complete History of Stupidity',
      channel: 'Your Mechanic Friend',
      channelId: 'UCOpkc4muSORQ3xQnT5b0upw',
      views: 66800,
      publishedAt: '2026-06-09',
      breakoutScore: 105,
    })
    expect(videos[2]?.views).toBe(503500)
  })

  it('keeps missing outlier pieces null and skips a block with no video id', () => {
    const answer = [
      '### 1. No id here\n- **Channel:** X',
      '### 2. Bare\n- **Video:** videoId `abcdefghijk`',
    ].join('\n\n')
    expect(parseOutliers({ answer })).toEqual([
      {
        videoId: 'abcdefghijk',
        title: 'Bare',
        channel: null,
        channelId: null,
        views: null,
        publishedAt: null,
        breakoutScore: null,
      },
    ])
  })

  it('reads a breakout score with a thousands comma', () => {
    const answer = [
      '### 1. T',
      '- **Performance:** 1.2M views · 1,050x breakout',
      '- **Video:** videoId `abcdefghijk`',
    ].join('\n')
    expect(parseOutliers({ answer })[0]).toEqual(
      expect.objectContaining({ views: 1200000, breakoutScore: 1050 }),
    )
  })

  it('takes the channel from channelTitle and keeps null scores', () => {
    const videos = parseChannelVideos(channelVideos)
    expect(videos[0]).toEqual(
      expect.objectContaining({ channel: 'Boom & Busters', views: 49, breakoutScore: null }),
    )
  })

  it('splits a transcript at its markers and strips the noise', () => {
    const t = parseTranscript(transcript)
    expect(t.segments[0]?.start).toBe(0)
    expect(t.segments[0]?.text.startsWith('In the summer of 1995, if you walked')).toBe(true)
    expect(t.segments[1]?.start).toBe(17)
    expect(JSON.stringify(t)).not.toContain('[music]')
    expect(parseTranscript({ transcription: '[1:02:03] >> hi [music] there' }).segments).toEqual([
      { start: 3723, text: 'hi there' },
    ])
    expect(parseTranscript({ transcription: 'no markers' }).segments).toEqual([
      { start: null, text: 'no markers' },
    ])
  })

  it('reads the keyword table, nulls kept', () => {
    const rows = parseKeywordTable(
      '| keyword | volume | competition | overall | x |\n|---|---|---|---|---|\n| a b | 64 | null | 63 | 1 |\n',
    )
    expect(rows).toEqual([{ keyword: 'a b', volume: 64, competition: null, overall: 63 }])
  })

  it('reads the balance', () => {
    expect(parseBalance(balance)).toEqual({
      totalCredits: 1443,
      renewableResetsAt: '2026-11-27T11:39:38Z',
    })
  })

  it('prefers structured content, then JSON text, then raw text for keywords', () => {
    expect(parseVidiqResult('vidiq_balance', { structuredContent: { a: 1 } })).toEqual({ a: 1 })
    expect(
      parseVidiqResult('vidiq_score_title', { content: [{ type: 'text', text: '{"score":80}' }] }),
    ).toEqual({ score: 80 })
    expect(
      parseVidiqResult('vidiq_keyword_research', { content: [{ type: 'text', text: '| a |' }] }),
    ).toBe('| a |')
  })

  it('a tool error becomes a VidiqError naming the tool', () => {
    let caught: unknown
    try {
      parseVidiqResult('vidiq_outliers', {
        isError: true,
        content: [{ type: 'text', text: 'Out of credits' }],
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(VidiqError)
    expect((caught as VidiqError).tool).toBe('vidiq_outliers')
    expect((caught as VidiqError).message).toContain('Out of credits')
  })
})

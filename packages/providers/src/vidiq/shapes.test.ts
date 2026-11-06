import { describe, expect, it } from 'vitest'
import balance from './fixtures/balance.json'
import channelVideos from './fixtures/channel_videos.json'
import outliers from './fixtures/outliers.json'
import comments from './fixtures/video_comments.json'
import search from './fixtures/youtube_search.json'
import insights from './fixtures/comment_insights.json'
import poll from './fixtures/job_poll.json'
import transcript from './fixtures/video_transcript.json'
import {
  VidiqError,
  parseBalance,
  parseChannelVideos,
  isoDurationSeconds,
  parseJobPoll,
  parseKeywordTable,
  parseNicheJob,
  parseOutliers,
  parseVideoComments,
  parseYoutubeSearch,
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
      subscribers: 15600,
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
        subscribers: null,
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
    expect(rows).toEqual([
      {
        keyword: 'a b',
        volume: 64,
        competition: null,
        overall: 63,
        estimatedMonthlySearch: null,
        growthPct: null,
      },
    ])
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

describe('the search, comment and niche test parsers', () => {
  it('reads the probe search with sizes, views and seconds', () => {
    const rows = parseYoutubeSearch(search)
    const cult = rows.find((r) => r.videoId === 'c9Xm1bT50DQ')
    expect(cult).toEqual({
      videoId: 'c9Xm1bT50DQ',
      title: 'The $47 Billion Cult',
      channelTitle: 'MagnatesMedia',
      subscribers: 1860000,
      views: 2015621,
      publishedAt: '2025-03-15T16:48:00Z',
      seconds: 7506,
    })
    expect(rows[0]?.seconds).toBe(809)
    expect(parseYoutubeSearch({ results: [{ title: 'no id' }, { id: 'abc' }] })).toEqual([
      {
        videoId: 'abc',
        title: '',
        channelTitle: null,
        subscribers: null,
        views: null,
        publishedAt: null,
        seconds: null,
      },
    ])
    expect(parseYoutubeSearch({})).toEqual([])
  })

  it('decodes comment text and flattens replies', () => {
    const list = parseVideoComments(comments)
    const reply = list.find((c) => c.text.startsWith("He's still"))
    expect(reply).toEqual({
      text: "He's still worth 2.3 billion. How?",
      likes: 3,
      byOwner: false,
      isReply: true,
    })
    const owner = list[0]
    expect(owner?.byOwner).toBe(true)
    expect(owner?.isReply).toBe(false)
    expect(owner?.text).toContain('favourite business stories ever. This was')
    expect(owner?.text).toContain('\n\n')
    expect(owner?.text).not.toContain('<br>')
    expect(owner?.text).not.toContain('\r')
    expect(list.find((c) => c.text.startsWith('"you violated'))?.likes).toBe(2655)
    // A top comment comes before its replies.
    expect(list.map((c) => c.isReply)).toEqual([false, true, false, true, false])
  })

  it('strips tags, keeps link text and decodes numeric entities', () => {
    const raw = {
      comments: [
        {
          topComment: {
            text: 'a &amp; b &lt;c&gt; &#8217; <a href="https://x.test">link text</a> <b>bold</b>',
            likeCount: 1,
          },
        },
      ],
    }
    expect(parseVideoComments(raw)[0]?.text).toBe('a & b <c> \u2019 link text bold')
    expect(parseVideoComments({})).toEqual([])
  })

  it('parses ISO durations', () => {
    expect(isoDurationSeconds('PT13M29S')).toBe(809)
    expect(isoDurationSeconds('PT2H5M6S')).toBe(7506)
    expect(isoDurationSeconds('PT45S')).toBe(45)
    expect(isoDurationSeconds(null)).toBeNull()
    expect(isoDurationSeconds('nonsense')).toBeNull()
  })

  it('reads a job id and every poll state', () => {
    expect(parseNicheJob(insights)).toEqual({ jobId: 'job_fixture_0001' })
    expect(() => parseNicheJob({})).toThrow(VidiqError)
    expect(parseJobPoll({ status: 'inprogress' })).toEqual({ status: 'inprogress' })
    const done = parseJobPoll(poll)
    expect(done.status).toBe('completed')
    expect(done.status === 'completed' && (done.result as { verdict: string }).verdict).toEqual(
      expect.any(String),
    )
    expect(parseJobPoll({ status: 'failed', refunded: true })).toEqual({
      status: 'failed',
      refunded: true,
    })
    expect(parseJobPoll({ status: 'expired' })).toEqual({ status: 'expired', refunded: false })
    expect(() => parseJobPoll({ status: 'weird' })).toThrow(VidiqError)
  })
})

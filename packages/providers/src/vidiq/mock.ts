import { clientOver } from './client'
import type { VidiqCaller, VidiqClient } from './client'
import balance from './fixtures/balance.json' with { type: 'json' }
import { KEYWORD_RESEARCH_MARKDOWN } from './fixtures/keyword-research'
import { KEYWORD_QUESTIONS_MARKDOWN } from './fixtures/keyword-questions'
import commentInsights from './fixtures/comment_insights.json' with { type: 'json' }
import jobPoll from './fixtures/job_poll.json' with { type: 'json' }
import videoComments from './fixtures/video_comments.json' with { type: 'json' }
import youtubeSearch from './fixtures/youtube_search.json' with { type: 'json' }
import channelVideos from './fixtures/channel_videos.json' with { type: 'json' }
import getVideosByIds from './fixtures/get_videos_by_ids.json' with { type: 'json' }
import outliers from './fixtures/outliers.json' with { type: 'json' }
import scoreTitle from './fixtures/score_title.json' with { type: 'json' }
import videoTranscript from './fixtures/video_transcript.json' with { type: 'json' }
import type { VidiqRawResult, VidiqTool } from './shapes'

/**
 * Serves the recorded responses (fixtures/README.md) through the same parsers
 * as the live client. Whatever the arguments, the answer is the recording, except that a `questions` keyword call
 * gets the questions stand-in.
 */
const JSON_FIXTURES: Partial<Record<VidiqTool, unknown>> = {
  vidiq_balance: balance,
  vidiq_channel_videos: channelVideos,
  vidiq_outliers: outliers,
  vidiq_get_videos_by_ids: getVideosByIds,
  vidiq_video_transcript: videoTranscript,
  vidiq_score_title: scoreTitle,
  vidiq_youtube_search: youtubeSearch,
  vidiq_video_comments: videoComments,
  vidiq_comment_insights: commentInsights,
  // The niche test finishes on the first poll.
  vidiq_job_poll: jobPoll,
}

/**
 * A `research` call measures the phrase it was given, so the stand-in echoes
 * that phrase back (lower case, as VidIQ does) with fixed figures: a mock run
 * then shows the subject and seed keywords measured (decision 467).
 */
export function researchSeedMarkdown(keyword: string): string {
  const phrase = keyword.trim().replace(/\s+/g, ' ').toLowerCase()
  return [
    `## Keyword research — mode: research`,
    '',
    '### seedKeyword (1)',
    '| keyword | volume | competition | overall | estimatedMonthlySearch | searchDemandGrowthPct | topMarkets (top 3) |',
    '|---|---|---|---|---|---|---|',
    `| ${phrase} | 66 | 30 | 68 | 24000 | null | none |`,
    '',
  ].join('\n')
}

const serve: VidiqCaller = async (tool, args): Promise<VidiqRawResult> => {
  if (tool === 'vidiq_keyword_research') {
    const text =
      args['mode'] === 'research'
        ? researchSeedMarkdown(String(args['keyword'] ?? ''))
        : args['mode'] === 'questions'
          ? KEYWORD_QUESTIONS_MARKDOWN
          : KEYWORD_RESEARCH_MARKDOWN
    return { content: [{ type: 'text', text }] }
  }
  return { structuredContent: JSON_FIXTURES[tool] }
}

export function mockVidiqClient(): VidiqClient {
  return clientOver(serve, async () => {})
}

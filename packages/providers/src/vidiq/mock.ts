import { clientOver } from './client'
import type { VidiqCaller, VidiqClient } from './client'
import balance from './fixtures/balance.json'
import { KEYWORD_RESEARCH_MARKDOWN } from './fixtures/keyword-research'
import channelVideos from './fixtures/channel_videos.json'
import getVideosByIds from './fixtures/get_videos_by_ids.json'
import outliers from './fixtures/outliers.json'
import scoreTitle from './fixtures/score_title.json'
import videoTranscript from './fixtures/video_transcript.json'
import type { VidiqRawResult, VidiqTool } from './shapes'

/**
 * Serves the recorded responses (fixtures/README.md) through the same parsers
 * as the live client. Whatever the arguments, the answer is the recording.
 */
const JSON_FIXTURES: Partial<Record<VidiqTool, unknown>> = {
  vidiq_balance: balance,
  vidiq_channel_videos: channelVideos,
  vidiq_outliers: outliers,
  vidiq_get_videos_by_ids: getVideosByIds,
  vidiq_video_transcript: videoTranscript,
  vidiq_score_title: scoreTitle,
}

const serve: VidiqCaller = async (tool): Promise<VidiqRawResult> => {
  if (tool === 'vidiq_keyword_research') {
    return { content: [{ type: 'text', text: KEYWORD_RESEARCH_MARKDOWN }] }
  }
  return { structuredContent: JSON_FIXTURES[tool] }
}

export function mockVidiqClient(): VidiqClient {
  return clientOver(serve, async () => {})
}

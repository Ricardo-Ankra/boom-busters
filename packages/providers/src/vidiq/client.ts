import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  VidiqError,
  creditsUsed,
  parseBalance,
  parseChannelVideos,
  parseKeywordTable,
  parseOutliers,
  parseScore,
  parseTranscript,
  parseVideoDetails,
  parseVidiqResult,
} from './shapes'
import { VIDIQ_CREDIT_COST } from './costs'
import type {
  VidiqBalance,
  VidiqCall,
  VidiqKeywordRow,
  VidiqRawResult,
  VidiqTool,
  VidiqTranscript,
  VidiqVideo,
  VidiqVideoDetail,
} from './shapes'

export { VidiqError } from './shapes'

export const VIDIQ_ENDPOINT = 'https://mcp.vidiq.com/mcp'

export interface VidiqClient {
  balance(): Promise<VidiqBalance>
  channelVideos(channel: string): Promise<VidiqCall<VidiqVideo[]>>
  outliers(args: {
    keyword: string
    language?: string
    limit?: number
  }): Promise<VidiqCall<VidiqVideo[]>>
  getVideosByIds(ids: string[]): Promise<VidiqCall<VidiqVideoDetail[]>>
  videoTranscript(args: { videoId: string; language?: string }): Promise<VidiqCall<VidiqTranscript>>
  keywordResearch(keyword: string): Promise<VidiqCall<VidiqKeywordRow[]>>
  scoreTitle(title: string): Promise<VidiqCall<{ score: number | null }>>
  close(): Promise<void>
}

/** One tool call's raw result: the live transport, or a fixture. */
export type VidiqCaller = (
  tool: VidiqTool,
  args: Record<string, unknown>,
) => Promise<VidiqRawResult>

/** The client's methods over any caller, so the live and mock clients share every parser. */
export function clientOver(call: VidiqCaller, close: () => Promise<void>): VidiqClient {
  async function run<T>(
    tool: VidiqTool,
    args: Record<string, unknown>,
    cost: number,
    parse: (raw: unknown) => T,
  ): Promise<VidiqCall<T>> {
    const raw = parseVidiqResult(tool, await call(tool, args))
    return { data: parse(raw), credits: creditsUsed(raw) ?? cost }
  }

  return {
    async balance() {
      return parseBalance(parseVidiqResult('vidiq_balance', await call('vidiq_balance', {})))
    },
    channelVideos: (channel) =>
      run(
        'vidiq_channel_videos',
        { channelId: channel, videoFormat: 'long', popular: true },
        VIDIQ_CREDIT_COST.channelVideos,
        parseChannelVideos,
      ),
    outliers: ({ keyword, language, limit }) =>
      run(
        'vidiq_outliers',
        { keyword, limit: limit ?? 20, ...(language ? { language } : {}) },
        VIDIQ_CREDIT_COST.outliers,
        parseOutliers,
      ),
    getVideosByIds: (ids) =>
      run(
        'vidiq_get_videos_by_ids',
        { videoIds: ids },
        VIDIQ_CREDIT_COST.getVideosByIds,
        parseVideoDetails,
      ),
    videoTranscript: ({ videoId, language }) =>
      run(
        'vidiq_video_transcript',
        { videoId, ...(language ? { language } : {}) },
        VIDIQ_CREDIT_COST.videoTranscript,
        parseTranscript,
      ),
    keywordResearch: (keyword) =>
      run(
        'vidiq_keyword_research',
        { keyword, mode: 'matching_terms', limit: 8 },
        VIDIQ_CREDIT_COST.keywordResearch,
        (raw) => parseKeywordTable(typeof raw === 'string' ? raw : ''),
      ),
    scoreTitle: (title) =>
      run('vidiq_score_title', { title, type: 'long' }, VIDIQ_CREDIT_COST.scoreTitle, parseScore),
    close,
  }
}

/**
 * The live client: the MCP SDK over streamable HTTP with a bearer key,
 * connected on the first call. Read-only tools only.
 */
export function createVidiqClient(apiKey: string, options?: { endpoint?: string }): VidiqClient {
  const endpoint = new URL(options?.endpoint ?? VIDIQ_ENDPOINT)
  let client: Client | null = null
  let connecting: Promise<Client> | null = null

  // A fresh Client and transport per attempt: a transport that failed to
  // start cannot be started again.
  async function connect(): Promise<Client> {
    const next = new Client({ name: 'boom-busters', version: '0.1.0' })
    await next.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      }),
    )
    client = next
    return next
  }

  const call: VidiqCaller = async (tool, args) => {
    connecting ??= connect()
    let connected: Client
    try {
      connected = await connecting
    } catch (error) {
      connecting = null
      throw new VidiqError(tool, error instanceof Error ? error.message : String(error))
    }
    try {
      return (await connected.callTool({ name: tool, arguments: args })) as VidiqRawResult
    } catch (error) {
      if (error instanceof VidiqError) throw error
      throw new VidiqError(tool, error instanceof Error ? error.message : String(error))
    }
  }

  return clientOver(call, async () => {
    const open = client
    client = null
    connecting = null
    if (open) await open.close()
  })
}

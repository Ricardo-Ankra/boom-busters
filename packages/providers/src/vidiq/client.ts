import { ValidationError } from '@boom-busters/schemas'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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
    requireAllTitleTerms?: boolean
    publishedWithin?: 'allTime' | 'year' | 'month'
  }): Promise<VidiqCall<VidiqVideo[]>>
  getVideosByIds(ids: string[]): Promise<VidiqCall<VidiqVideoDetail[]>>
  videoTranscript(args: { videoId: string; language?: string }): Promise<VidiqCall<VidiqTranscript>>
  keywordResearch(
    keyword: string,
    options?: { mode?: 'matching_terms' | 'questions'; limit?: number },
  ): Promise<VidiqCall<VidiqKeywordRow[]>>
  scoreTitle(args: {
    title: string
    channelId?: string
    type?: 'long' | 'short'
  }): Promise<VidiqCall<{ score: number | null }>>
  close(): Promise<void>
}

/** One tool call's raw result: the live transport, or a fixture. */
export type VidiqCaller = (
  tool: VidiqTool,
  args: Record<string, unknown>,
) => Promise<VidiqRawResult>

/**
 * A refused key, as the error the verify path already treats as non-retriable
 * (the LLM and fal adapters throw the same `ValidationError` for a 401 or 403).
 * The transport reports HTTP 401 and 403 as a `StreamableHTTPError` with the
 * status as its code; VidIQ's own tools say it in an error result's text.
 */
function refusedKey(tool: string, error: unknown): ValidationError | undefined {
  const status = error instanceof StreamableHTTPError ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error)
  // Only the verify call reads a key refusal from text: another tool's error result may say
  // "Forbidden" about a video, and that must stay a VidiqError the caller can skip.
  const says =
    tool === 'vidiq_balance' &&
    error instanceof VidiqError &&
    /unauthori[sz]ed|forbidden|invalid api key/i.test(message)
  if (status !== 401 && status !== 403 && !says) return undefined
  return new ValidationError(
    `vidiq refused the API key${status ? ` (${status})` : ''}. Check it in Settings, Connections.`,
    { field: 'connections.vidiq', cause: error },
  )
}

/** The client's methods over any caller, so the live and mock clients share every parser. */
export function clientOver(call: VidiqCaller, close: () => Promise<void>): VidiqClient {
  async function run<T>(
    tool: VidiqTool,
    args: Record<string, unknown>,
    cost: number,
    parse: (raw: unknown) => T,
  ): Promise<VidiqCall<T>> {
    const raw = await parsed(tool, args)
    return { data: parse(raw), credits: creditsUsed(raw) ?? cost, args }
  }

  async function parsed(tool: VidiqTool, args: Record<string, unknown>): Promise<unknown> {
    try {
      return parseVidiqResult(tool, await call(tool, args))
    } catch (error) {
      throw refusedKey(tool, error) ?? error
    }
  }

  return {
    async balance() {
      return parseBalance(await parsed('vidiq_balance', {}))
    },
    channelVideos: (channel) =>
      run(
        'vidiq_channel_videos',
        { channelId: channel, videoFormat: 'long', popular: true },
        VIDIQ_CREDIT_COST.channelVideos,
        parseChannelVideos,
      ),
    outliers: ({ keyword, language, limit, requireAllTitleTerms, publishedWithin }) =>
      run(
        'vidiq_outliers',
        {
          keyword,
          limit: limit ?? 20,
          ...(language ? { language } : {}),
          ...(requireAllTitleTerms !== undefined ? { requireAllTitleTerms } : {}),
          ...(publishedWithin ? { publishedWithin } : {}),
        },
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
    keywordResearch: (keyword, options) =>
      run(
        'vidiq_keyword_research',
        { keyword, mode: options?.mode ?? 'matching_terms', limit: options?.limit ?? 8 },
        VIDIQ_CREDIT_COST.keywordResearch,
        (raw) => parseKeywordTable(typeof raw === 'string' ? raw : ''),
      ),
    scoreTitle: ({ title, channelId, type }) =>
      run(
        'vidiq_score_title',
        { title, type: type ?? 'long', ...(channelId ? { channelId } : {}) },
        VIDIQ_CREDIT_COST.scoreTitle,
        parseScore,
      ),
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
      throw (
        refusedKey(tool, error) ??
        new VidiqError(tool, error instanceof Error ? error.message : String(error))
      )
    }
    try {
      return (await connected.callTool({ name: tool, arguments: args })) as VidiqRawResult
    } catch (error) {
      if (error instanceof VidiqError) throw error
      throw (
        refusedKey(tool, error) ??
        new VidiqError(tool, error instanceof Error ? error.message : String(error))
      )
    }
  }

  return clientOver(call, async () => {
    const open = client
    client = null
    connecting = null
    if (open) await open.close()
  })
}

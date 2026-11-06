/**
 * What VidIQ's MCP tools return, parsed into the shapes the research run
 * reads. The tools answer in three different formats (JSON, JSON wrapping a
 * markdown answer, plain markdown), so each tool has its own parser. A value
 * the response does not carry is kept `null`, never zero: a missing view count
 * is unknown, not an unwatched video.
 */

export type VidiqTool =
  | 'vidiq_balance'
  | 'vidiq_channel_videos'
  | 'vidiq_outliers'
  | 'vidiq_get_videos_by_ids'
  | 'vidiq_video_transcript'
  | 'vidiq_keyword_research'
  | 'vidiq_score_title'
  | 'vidiq_youtube_search'
  | 'vidiq_video_comments'
  | 'vidiq_comment_insights'
  | 'vidiq_job_poll'

export class VidiqError extends Error {
  readonly tool: string

  constructor(tool: string, message: string) {
    super(message)
    this.name = 'VidiqError'
    this.tool = tool
  }
}

export interface VidiqVideo {
  videoId: string
  title: string
  channel: string | null
  channelId: string | null
  views: number | null
  publishedAt: string | null
  breakoutScore: number | null
  /** The channel's subscriber count, from the outliers answer only; null elsewhere. */
  subscribers: number | null
}

export interface VidiqVideoDetail extends VidiqVideo {
  description: string | null
  tags: string[] | null
}

export interface VidiqTranscript {
  segments: { start: number | null; text: string }[]
}

export interface VidiqKeywordRow {
  keyword: string
  volume: number | null
  competition: number | null
  overall: number | null
  estimatedMonthlySearch: number | null
  /** `searchDemandGrowthPct` as a number: "-39.1%" is -39.1. */
  growthPct: number | null
}

export interface VidiqBalance {
  totalCredits: number
  renewableResetsAt: string | null
}

export interface VidiqSearchResult {
  videoId: string
  title: string
  channelTitle: string | null
  subscribers: number | null
  views: number | null
  publishedAt: string | null
  seconds: number | null
}

export interface VidiqComment {
  /** Decoded: HTML entities resolved, `<br>` as a newline, other tags stripped. */
  text: string
  likes: number
  byOwner: boolean
  isReply: boolean
}

export interface VidiqNicheJob {
  jobId: string
}

/** `result` stays unknown here: the niche test's mapping is tolerant and lives with its reader. */
export type VidiqJobState =
  | { status: 'inprogress' }
  | { status: 'completed'; result: unknown }
  | { status: 'failed' | 'expired'; refunded: boolean }

export interface VidiqCall<T> {
  data: T
  credits: number
  /** The arguments as sent on the wire, for the credits ledger. */
  args: Record<string, unknown>
}

export interface VidiqRawResult {
  isError?: boolean
  structuredContent?: unknown
  content?: { type: string; text?: string }[]
}

function firstText(result: VidiqRawResult): string | undefined {
  return result.content?.find((block) => block.type === 'text' && typeof block.text === 'string')
    ?.text
}

/**
 * Structured content when the server sent it, else the first text block parsed
 * as JSON, else (keyword research only, which answers in markdown) the raw text.
 * A result flagged `isError` throws, carrying the tool and its message.
 */
export function parseVidiqResult(tool: VidiqTool | string, result: VidiqRawResult): unknown {
  const text = firstText(result)
  if (result.isError) throw new VidiqError(tool, text ?? 'VidIQ reported an error with no message')
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent
  }
  if (text === undefined) throw new VidiqError(tool, 'VidIQ returned no content')
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (tool === 'vidiq_keyword_research') return text
    throw new VidiqError(tool, `VidIQ returned text that is not JSON: ${text.slice(0, 120)}`)
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** The credits a JSON response says it used, when it says. */
export function creditsUsed(raw: unknown): number | null {
  return num(record(record(raw)['_credits'])['used'])
}

/** "66.8K" and "1.2M" as whole numbers; "950" as itself. */
function abbreviated(count: string, suffix: string | undefined): number | null {
  const base = Number(count.replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const scale = suffix === 'K' ? 1_000 : suffix === 'M' ? 1_000_000 : 1
  return Math.round(base * scale)
}

function matchOf(text: string, pattern: RegExp): RegExpMatchArray | null {
  return text.match(pattern)
}

/** The `### n. <title>` blocks of an outliers answer. A block with no videoId is skipped. */
export function parseOutliers(raw: unknown): VidiqVideo[] {
  const answer = str(record(raw)['answer']) ?? ''
  const videos: VidiqVideo[] = []
  for (const block of answer.split(/^### \d+\.\s+/m).slice(1)) {
    const videoId = matchOf(block, /videoId `([^`]+)`/)?.[1]
    if (!videoId) continue
    const title = block.split('\n')[0]?.trim() ?? ''
    const channelLine = matchOf(block, /\*\*Channel:\*\*\s*(.+)/)?.[1] ?? ''
    const channel = channelLine.split(' · ')[0]?.trim() ?? ''
    const views = matchOf(block, /([\d.,]+)([KM])? views(?!\/)/)
    const breakout = matchOf(block, /([\d.,]+)x breakout/)
    const subs = matchOf(channelLine, /([\d.,]+)([KM])? subscribers/)
    videos.push({
      videoId,
      title,
      channel: channel === '' ? null : channel,
      channelId: matchOf(channelLine, /channelId `([^`]+)`/)?.[1] ?? null,
      views: views?.[1] ? abbreviated(views[1], views[2]) : null,
      publishedAt: matchOf(block, /published (\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      breakoutScore: breakout?.[1] ? num(Number(breakout[1].replace(/,/g, ''))) : null,
      subscribers: subs?.[1] ? abbreviated(subs[1], subs[2]) : null,
    })
  }
  return videos
}

/** `channel_videos`: the channel's title sits at the top, not on each video. */
export function parseChannelVideos(raw: unknown): VidiqVideo[] {
  const top = record(raw)
  const channel = str(top['channelTitle'])
  const channelId = str(top['channelId'])
  const list = Array.isArray(top['videos']) ? top['videos'] : []
  const videos: VidiqVideo[] = []
  for (const item of list) {
    const v = record(item)
    const videoId = str(v['videoId'])
    if (!videoId) continue
    videos.push({
      videoId,
      title: str(v['title']) ?? '',
      channel,
      channelId,
      views: num(v['viewCount']),
      publishedAt: str(v['publishedAt']),
      breakoutScore: num(v['breakoutScore']),
      subscribers: null,
    })
  }
  return videos
}

/** `get_videos_by_ids`: each video names its own channel and carries `outlierScore`. */
export function parseVideoDetails(raw: unknown): VidiqVideoDetail[] {
  const list = record(raw)['videos']
  const details: VidiqVideoDetail[] = []
  for (const item of Array.isArray(list) ? list : []) {
    const v = record(item)
    const videoId = str(v['id'])
    if (!videoId) continue
    const tags = v['tags']
    details.push({
      videoId,
      title: str(v['title']) ?? '',
      channel: str(v['channelTitle']),
      channelId: str(v['channelId']),
      views: num(v['viewCount']),
      publishedAt: str(v['publishedAt']),
      breakoutScore: num(v['outlierScore']),
      subscribers: null,
      description: str(v['description']),
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : null,
    })
  }
  return details
}

const MARKER = /\[(?:(\d+):)?(\d{1,2}):(\d{2})\]/g

function cleanSpoken(text: string): string {
  return text
    .replace(/\[music\]/gi, ' ')
    .replace(/>>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The transcription is one string with `[m:ss]` markers opening each segment.
 * Without a marker anywhere it becomes one segment with no start time.
 */
export function parseTranscript(raw: unknown): VidiqTranscript {
  const transcription = str(record(raw)['transcription']) ?? ''
  const markers = [...transcription.matchAll(MARKER)]
  const segments: VidiqTranscript['segments'] = []
  const push = (start: number | null, chunk: string) => {
    const text = cleanSpoken(chunk)
    if (text !== '') segments.push({ start, text })
  }
  if (markers.length === 0) {
    push(null, transcription)
    return { segments }
  }
  push(null, transcription.slice(0, markers[0]?.index ?? 0))
  markers.forEach((marker, i) => {
    const from = (marker.index ?? 0) + marker[0].length
    const to = markers[i + 1]?.index ?? transcription.length
    const start = Number(marker[1] ?? 0) * 3600 + Number(marker[2]) * 60 + Number(marker[3])
    push(start, transcription.slice(from, to))
  })
  return { segments }
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function cellNumber(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** "+171.8%" and "-39.1%" as numbers; anything else is unknown. */
function cellPercent(value: string | undefined): number | null {
  if (value === undefined) return null
  return cellNumber(value.replace(/%$/, ''))
}

/** The pipe table of a keyword research answer; the header row names the columns. */
export function parseKeywordTable(markdown: string): VidiqKeywordRow[] {
  const lines = markdown.split(/\r?\n/)
  const rows: VidiqKeywordRow[] = []
  let header: string[] | null = null
  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|')) {
      header = null
      return
    }
    const row = cells(line)
    if (row.every((cell) => /^:?-+:?$/.test(cell))) return
    const next = lines[i + 1]?.trim() ?? ''
    if (next.startsWith('|') && cells(next).every((cell) => /^:?-+:?$/.test(cell))) {
      header = row
      return
    }
    if (!header) return
    const at = (name: string) => row[header?.indexOf(name) ?? -1]
    const keyword = at('keyword')
    if (!keyword || keyword === 'null') return
    rows.push({
      keyword,
      volume: cellNumber(at('volume')),
      competition: cellNumber(at('competition')),
      overall: cellNumber(at('overall')),
      estimatedMonthlySearch: cellNumber(at('estimatedMonthlySearch')),
      growthPct: cellPercent(at('searchDemandGrowthPct')),
    })
  })
  return rows
}

export function parseBalance(raw: unknown): VidiqBalance {
  const top = record(raw)
  const totalCredits = num(top['totalCredits'])
  if (totalCredits === null)
    throw new VidiqError('vidiq_balance', 'The balance has no totalCredits')
  return { totalCredits, renewableResetsAt: str(top['renewableResetsAt']) }
}

export function parseScore(raw: unknown): { score: number | null } {
  return { score: num(record(raw)['score']) }
}

/** "PT2H5M6S" as 7506 seconds; anything that is not an ISO duration is unknown. */
export function isoDurationSeconds(iso: string | null): number | null {
  if (iso === null) return null
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m || iso === 'P' || iso.endsWith('T')) return null
  return (
    Number(m[1] ?? 0) * 86400 +
    Number(m[2] ?? 0) * 3600 +
    Number(m[3] ?? 0) * 60 +
    Number(m[4] ?? 0)
  )
}

/** `youtube_search`: each result's id is `id`, its channel size is `subscriberCount`. */
export function parseYoutubeSearch(raw: unknown): VidiqSearchResult[] {
  const list = record(raw)['results']
  const rows: VidiqSearchResult[] = []
  for (const item of Array.isArray(list) ? list : []) {
    const v = record(item)
    const videoId = str(v['id'])
    if (!videoId) continue
    rows.push({
      videoId,
      title: str(v['title']) ?? '',
      channelTitle: str(v['channelTitle']),
      subscribers: num(v['subscriberCount']),
      views: num(v['viewCount']),
      publishedAt: str(v['publishedAt']),
      seconds: isoDurationSeconds(str(v['duration'])),
    })
  }
  return rows
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
}

/** Tags go first so an escaped `&lt;c&gt;` stays text; every entity is decoded in one pass. */
function decodeComment(html: string): string {
  return html
    .replace(/\r\n/g, '\n')
    .replace(/\r?<br\s*\/?>/gi, '\n')
    .replace(/\r/g, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|lt|gt|apos|nbsp));/gi,
      (whole: string, dec?: string, hex?: string, name?: string) => {
        if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole
        const code = dec ? Number(dec) : parseInt(hex ?? '', 16)
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      },
    )
    .trim()
}

function commentOf(raw: unknown, isReply: boolean): VidiqComment | null {
  const c = record(raw)
  const text = str(c['text'])
  if (text === null) return null
  return {
    text: decodeComment(text),
    likes: num(c['likeCount']) ?? 0,
    byOwner: c['byChannelOwner'] === true,
    isReply,
  }
}

/** `video_comments`: each thread's top comment, then its replies. */
export function parseVideoComments(raw: unknown): VidiqComment[] {
  const threads = record(raw)['comments']
  const out: VidiqComment[] = []
  for (const thread of Array.isArray(threads) ? threads : []) {
    const t = record(thread)
    const top = commentOf(t['topComment'], false)
    if (top) out.push(top)
    const replies = t['replies']
    for (const reply of Array.isArray(replies) ? replies : []) {
      const parsedReply = commentOf(reply, true)
      if (parsedReply) out.push(parsedReply)
    }
  }
  return out
}

/** `comment_insights` starts an asynchronous job and answers with its id. */
export function parseNicheJob(raw: unknown): VidiqNicheJob {
  const jobId = str(record(raw)['mcpJobId'])
  if (!jobId) throw new VidiqError('vidiq_comment_insights', 'The niche test returned no mcpJobId')
  return { jobId }
}

export function parseJobPoll(raw: unknown): VidiqJobState {
  const top = record(raw)
  const status = str(top['status'])
  if (status === 'inprogress') return { status }
  if (status === 'completed') return { status, result: top['result'] }
  if (status === 'failed' || status === 'expired') {
    return { status, refunded: top['refunded'] === true }
  }
  throw new VidiqError('vidiq_job_poll', `The job poll has an unknown status: ${String(status)}`)
}

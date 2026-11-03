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

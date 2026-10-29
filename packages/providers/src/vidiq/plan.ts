import type { BibleDraftInputs } from '@boom-busters/schemas'
import type { VidiqTranscript } from './shapes'

/** How many opening transcripts a research run buys. */
export const TRANSCRIPT_CAP = 4

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/
const HANDLE = /^@[A-Za-z0-9_.-]+$/
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
])

function asUrl(input: string): URL | null {
  try {
    return new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    return null
  }
}

/** `watch?v=`, `youtu.be/`, `/shorts/`, `/live/` and a bare 11-character id. */
export function videoIdFromUrl(input: string): string | null {
  const text = input.trim()
  if (VIDEO_ID.test(text)) return text
  const url = asUrl(text)
  if (!url) return null
  let id: string | null = null
  if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const [, kind, value] = url.pathname.split('/')
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else if (kind === 'shorts' || kind === 'live') id = value ?? null
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** `@handle`, a `youtube.com/@handle` link or a `/channel/UC…` link, as the handle or id. */
export function channelRefFromInput(input: string): string | null {
  const text = input.trim()
  if (HANDLE.test(text) || CHANNEL_ID.test(text)) return text
  const url = asUrl(text)
  if (!url || !YOUTUBE_HOSTS.has(url.hostname)) return null
  const [, first, second] = url.pathname.split('/')
  if (first && HANDLE.test(decodeURIComponent(first))) return decodeURIComponent(first)
  if (first === 'channel' && second && CHANNEL_ID.test(second)) return second
  return null
}

export interface ResearchPlan {
  channels: { ref: string; own: boolean }[]
  videoIds: string[]
  outlierKeyword: string
  language: string | null
}

const KEYWORD_MAX_CHARS = 80

/**
 * What a research run will fetch. The own channel (when it has a handle) goes
 * first. Returns an error naming the first input that does not parse: the
 * admired channels are read before the videos.
 */
export function planResearch(
  inputs: BibleDraftInputs,
  own: { handle: string | null; language: string | null },
): ResearchPlan | { error: string } {
  const channels: ResearchPlan['channels'] = []
  const seen = new Set<string>()
  const add = (ref: string, isOwn: boolean) => {
    if (seen.has(ref.toLowerCase())) return
    seen.add(ref.toLowerCase())
    channels.push({ ref, own: isOwn })
  }

  const ownRef = own.handle ? (channelRefFromInput(own.handle) ?? own.handle) : null
  if (ownRef) add(ownRef, true)

  for (const input of inputs.admiredChannels) {
    if (input.trim() === '') continue
    const ref = channelRefFromInput(input)
    if (!ref) return { error: `Not a YouTube channel: ${input}` }
    add(ref, false)
  }

  const videoIds: string[] = []
  for (const input of inputs.videos) {
    if (input.trim() === '') continue
    const id = videoIdFromUrl(input)
    if (!id) return { error: `Not a YouTube video link: ${input}` }
    if (!videoIds.includes(id)) videoIds.push(id)
  }

  return {
    channels,
    videoIds,
    outlierKeyword: inputs.description.replace(/\s+/g, ' ').trim().slice(0, KEYWORD_MAX_CHARS),
    language: own.language,
  }
}

/** Five credits a call: each channel, one batched video lookup, the outliers, and the transcripts. */
export function estimateResearchCredits(plan: ResearchPlan): number {
  const calls = plan.channels.length + (plan.videoIds.length > 0 ? 1 : 0) + 1 + TRANSCRIPT_CAP
  return 5 * calls
}

const NO_TIMINGS_CHARS = 900

/** The segments that start before `seconds`; without timings, the first 900 characters. */
export function transcriptOpening(t: VidiqTranscript, seconds = 60): string {
  if (t.segments.every((segment) => segment.start === null)) {
    return t.segments
      .map((segment) => segment.text)
      .join(' ')
      .slice(0, NO_TIMINGS_CHARS)
  }
  return t.segments
    .filter((segment) => segment.start !== null && segment.start < seconds)
    .map((segment) => segment.text)
    .join(' ')
}

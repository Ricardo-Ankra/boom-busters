import { BibleResearchDigestSchema, EMPTY_BIBLE } from '@boom-busters/schemas'
import type { BibleDraftInputs, BibleResearchDigest } from '@boom-busters/schemas'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
import { fillSlots, literalBibleText } from './bible'
import { parseJsonCompletion } from './json'

/**
 * The research digest: what the channel's admired videos and its own lines
 * have in common, as patterns that each keep the videos they came from. The
 * model sees titles, openings and the channel's own lines, never a transcript
 * in full; only the digest is stored.
 */

export const DIGEST_QUOTE_MAX = 200

export function buildResearchDigestRequest(input: {
  channelName: string
  inputs: BibleDraftInputs
  videos: BibleResearchDigest['videos']
  openings: { videoId: string; text: string }[]
  ownLines: string[]
}): LLMTaskRequest {
  const { inputs } = input
  const owner = [`Description: ${inputs.description}`]
  if (inputs.audience) owner.push(`Audience: ${inputs.audience}`)
  if (inputs.avoid) owner.push(`To avoid: ${inputs.avoid}`)

  const videos = input.videos.map(
    (v) =>
      `- ${v.videoId} | ${v.title} | ${v.channel} | ${v.own ? 'own' : 'other'} | ${v.views ?? 'views unknown'} views`,
  )
  const openings = input.openings.map((o) => `- ${o.videoId}: ${o.text}`)
  const own = input.ownLines.map((line) => `- ${line}`)

  const sections = [
    `## The owner's inputs\n\n${owner.join('\n')}`,
    `## Videos\n\n${videos.join('\n') || 'None.'}`,
    `## Openings, by video\n\n${openings.join('\n') || 'None.'}`,
    `## The channel's own lines\n\n${own.join('\n') || 'None.'}`,
    `## What to write

Find the patterns that recur across these videos in titles, hooks, openings and what the audience responds to. For each pattern give its kind ("title", "hook", "opening" or "audience"), the pattern in one or two sentences, at most one short quote that shows it (null when there is none; at most ${DIGEST_QUOTE_MAX} characters), and the one to five videos it was seen in, copied exactly from the Videos list (videoId, channel, title, own). Every source must be a video from the list. Never invent a video, a quote or a number.

Also return the videos you used, each as { videoId, channel, title, views, own }.

Answer with one JSON object { "patterns": [...], "videos": [...] } and nothing else: no prose, no markdown fence.`,
  ]

  return {
    task: 'bible',
    system: fillSlots(
      `You read research on YouTube videos for the channel ${literalBibleText(input.channelName)} and report the patterns in it, so its bible can be drafted from evidence. Report what is there; never a line you would write yourself.`,
      { bible: EMPTY_BIBLE, slotIds: [] },
    ),
    messages: [
      {
        role: 'user',
        content: fillSlots(literalBibleText(sections.join('\n\n')), {
          bible: EMPTY_BIBLE,
          slotIds: [],
        }),
      },
    ],
    maxTokens: outputBudget(6000),
  }
}

export function parseResearchDigest(text: string): BibleResearchDigest {
  return parseJsonCompletion(text, BibleResearchDigestSchema, 'research digest')
}

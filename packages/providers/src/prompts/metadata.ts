import { ValidationError } from '@boom-busters/schemas'
import { z } from 'zod'
import { parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The 'metadata' task (build spec sections 7 and 11.3): candidate YouTube
 * titles for one publish item, offered on the Publish screen as a radio list
 * beside a free-edit field. Haiku-tier work by default — the routing matrix
 * decides, this file only shapes the request.
 *
 * Only titles are generated. The description is composed deterministically
 * from things that already exist (hook paragraph, chapter timestamps, dossier
 * sources, disclaimer — see `composePublishDescription` in schemas): asking a
 * model to restate facts that are already on file is how a description ends
 * up contradicting the video it sits under.
 */

/** How many candidates the screen asks for. Spec: "the 8-10 generated options". */
export const TITLE_OPTION_COUNT = 8

/** YouTube truncates at 100; anything longer would publish less than shown. */
const TITLE_MAX_CHARS = 100

export function buildTitlesRequest(input: {
  caseTitle: string
  /** The hook the title has to live up to — the script's opening paragraph. */
  hook: string
  target: 'master' | 'short'
  /** The working title, offered to the model as the angle already chosen. */
  workingTitle: string
}): LLMTaskRequest {
  const shape = `Return JSON: {"titles": ["...", ...]} — exactly ${TITLE_OPTION_COUNT} strings.`

  return {
    task: 'metadata',
    system: `You write YouTube titles for Boom & Busters, a documentary channel
about corporate collapses, cons and meltdowns. Sober, specific, curiosity-driven —
never clickbait that the video cannot pay off, never ALL CAPS, no emoji.

${shape}

Rules:
- Each title is at most ${TITLE_MAX_CHARS} characters and at least 20.
- Name the company or person; a title that could sit on any video is a bad title.
- Vary the mechanism across the set: a question, a number, a timeline
  ("Nine days"), a contradiction, a consequence. No two titles may share
  their first three words.
${
  input.target === 'short'
    ? '- These are for a vertical Short cut from the full video: punchier, front-loaded, the payoff visible in the first five words.'
    : '- These are for the full documentary: they can breathe, but the stakes must be in the first half.'
}`,
    messages: [
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}\n` +
          `Working title: ${input.workingTitle}\n\n` +
          `Opening hook:\n${input.hook}`,
      },
    ],
    maxTokens: outputBudget(1000),
  }
}

const TitlesEnvelopeSchema = z.object({
  titles: z.array(z.string()).min(1, 'at least one title'),
})

/**
 * Candidates out of a completion: trimmed, deduplicated, length-enforced,
 * capped. Lenient item-by-item like the shot list — one overlong title is
 * dropped, not retried at full price — but an answer with nothing usable in
 * it throws, so the retry buys a genuinely fresh set.
 */
export function parseTitleOptions(text: string): string[] {
  const envelope = parseJsonCompletion(text, TitlesEnvelopeSchema, 'title options')

  const seen = new Set<string>()
  const titles: string[] = []
  for (const raw of envelope.titles) {
    // "1. Title" or "\"Title\"" — list habits some models keep even in JSON.
    const title = raw
      .trim()
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^"(.*)"$/, '$1')
      .trim()
    if (title.length === 0 || title.length > TITLE_MAX_CHARS) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(title)
    if (titles.length === 10) break
  }

  if (titles.length === 0) {
    throw new ValidationError(
      'Every title in the model\'s answer was unusable — empty or over ' +
        `${TITLE_MAX_CHARS} characters.`,
      { field: 'title options' },
    )
  }

  return titles
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/**
 * Mock titles, obviously mock (same rule as every other mock: output that
 * looks real gets pasted somewhere real). Deterministic — a pure function of
 * the working title — and varied enough to exercise the radio list.
 */
export function mockTitleOptions(workingTitle: string): string[] {
  // Cut so the longest template stays inside the 100-character title limit.
  const stem = workingTitle.trim().slice(0, 48) || 'Untitled'
  return [
    `[mock] ${stem} — the whole story`,
    `[mock] How ${stem} actually happened`,
    `[mock] ${stem}: nine days from record high to nothing`,
    `[mock] The number that gave ${stem} away`,
    `[mock] What ${stem} cost everyone else`,
    `[mock] ${stem}, minute by minute`,
    `[mock] Why nobody stopped ${stem}`,
    `[mock] ${stem}: the warning signs were public`,
  ]
}

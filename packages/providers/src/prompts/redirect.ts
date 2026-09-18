import { renderDirectorsBook, StillBriefSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook, StillBrief } from '@boom-busters/schemas'
import { z } from 'zod'
import { DIRECTION_CRAFT } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * Redirect a refused still (decision 252): the image model declined a
 * likeness, so the same beat is re-planned without the person, following the
 * bible's People section. `coversText` never changes; only the frame does.
 * Routed to the shot-list task: it is one small planning call, not drafting.
 */

export function buildRedirectRequest(input: {
  caseTitle: string
  brief: StillBrief
  /** The provider's refusal, so the model knows what to avoid repeating. */
  reason: string
  direction: DirectorsBook | null
}): LLMTaskRequest {
  return {
    task: 'shotlist',
    system: `You are re-planning ONE still of a documentary. The image model refused the
current prompt. Rewrite the brief for the same story beat without the person:
the podium after the speech, the door they walked through, the desk as they left it, or
an anonymous figure described by role, build and clothing with the face turned
away. Keep "coversText" EXACTLY as given; keep "motion", "transition" and
"shotSize"; rewrite "description" and "prompt"; omit "depicts" entirely.

${DIRECTION_CRAFT}

Return JSON: {"brief": {"type": "still", "coversText", "description", "shotSize",
"motion", "transition", "prompt", "negativePrompt"?}}`,
    messages: [
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}` +
          (input.direction ? `\n\nDirector's book:\n${renderDirectorsBook(input.direction)}` : ''),
      },
      {
        role: 'user',
        content: `Refusal: ${input.reason}\n\nThe current brief:\n${JSON.stringify(input.brief, null, 2)}`,
      },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(1200),
  }
}

const Envelope = z.object({ brief: z.unknown() })

export function parseRedirectedBrief(text: string, original: StillBrief): StillBrief {
  const envelope = parseJsonCompletion(text, Envelope, 'redirected brief')
  const parsed = StillBriefSchema.safeParse(envelope.brief)
  if (!parsed.success) {
    throw new ValidationError(`The redirected brief is malformed: ${formatIssues(parsed.error)}`, {
      field: 'redirected brief',
    })
  }
  if (parsed.data.depicts && parsed.data.depicts.length > 0) {
    throw new ValidationError('The redirected brief still depicts a real person.', {
      field: 'redirected brief',
    })
  }
  if (parsed.data.coversText !== original.coversText) {
    throw new ValidationError('The redirected brief changed the sentence it covers.', {
      field: 'redirected brief',
    })
  }
  return parsed.data
}

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

/** Deterministic redirect for `MOCK_PROVIDERS=1`: the place after the person has left. */
export function mockRedirectedBrief(brief: StillBrief): StillBrief {
  const { depicts: _depicts, ...rest } = brief
  return {
    ...rest,
    description: `[mock] ${brief.description} Redirected: the place after the person has left.`,
    prompt:
      '[mock] An empty podium under a single spotlight, a glass of water half drunk, dust in ' +
      `the beam. ${brief.prompt}`,
  }
}

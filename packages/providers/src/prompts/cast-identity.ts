import { ValidationError } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest, MsgImage } from '../llm/types'

/**
 * The cast-identity prompt (decision 253): one vision call per cast member,
 * after their first photo lands, that writes the identity string the image
 * prompts carry as a text backstop.
 *
 * The photographs are the mechanism for likeness; this text is what a model
 * reads when it has no photograph, and what the planner reads when it
 * describes the person. It is written from the pictures, not from the
 * model's memory of the name, so it says what is visible and nothing else.
 * Routed to the `direction` task (Sonnet by default) because it needs
 * vision and runs once per person.
 */

/** The bible's standard exclusions, offered as the guardrail's starting text. */
export const DEFAULT_GUARDRAIL =
  'never handling cash or signing an invented contract; never in handcuffs; ' +
  'never mocked, caricatured or shown in humiliation'

export const IDENTITY_MAX_CHARS = 600

export function buildCastIdentityRequest(input: {
  name: string
  role: string
  photos: readonly MsgImage[]
}): LLMTaskRequest {
  if (input.photos.length === 0) {
    throw new ValidationError('An identity string is written from photographs; upload one first.', {
      field: 'photos',
    })
  }
  return {
    task: 'direction',
    system: `You describe a real person from photographs so that an image model can
render their likeness. Write what a photographer would note and nothing else.

Return JSON: {"identityString": string, "guardrail": string}

Rules:
- "identityString" is at most 60 words, one sentence, in this order: face
  shape; hair (colour, length, style, or bald); beard or moustache or
  clean-shaven; glasses or none; apparent age range; build; the dress the
  photographs show. Begin with the person's full name and role exactly as
  given.
- Only what is visible. No character, mood, health, nationality or ethnicity
  beyond what the photographs plainly show; no guesses about anything the
  frame does not contain.
- No banned words: cinematic, stunning, dramatic lighting, high quality,
  masterpiece, epic, beautiful, moody, professional.
- "guardrail" is one line listing only defamation and mockery exclusions for
  this person. Start from: "${DEFAULT_GUARDRAIL}". Add nothing that keeps
  them away from ordinary settings such as desks, documents, boardrooms or
  meetings.`,
    messages: [
      {
        role: 'user',
        content:
          `Describe ${input.name}, ${input.role}, as a photograph would, ` +
          `from the ${input.photos.length === 1 ? 'photograph' : 'photographs'} attached.`,
        images: [...input.photos],
      },
    ],
    maxTokens: outputBudget(400),
  }
}

const IdentitySchema = z.object({
  identityString: z.string().trim().min(1).max(IDENTITY_MAX_CHARS),
  guardrail: z.string().trim().max(IDENTITY_MAX_CHARS).optional(),
})

export function parseCastIdentity(text: string): { identityString: string; guardrail: string } {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'cast identity')
  const parsed = IdentitySchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(`The identity answer was malformed: ${formatIssues(parsed.error)}`, {
      field: 'identityString',
    })
  }
  return {
    identityString: parsed.data.identityString,
    guardrail:
      parsed.data.guardrail && parsed.data.guardrail.length > 0
        ? parsed.data.guardrail
        : DEFAULT_GUARDRAIL,
  }
}

/** Deterministic stand-in for mock-provider mode; no photograph is read. */
export function mockCastIdentity(input: { name: string; role: string }): {
  identityString: string
  guardrail: string
} {
  return {
    identityString:
      `[mock] ${input.name}, ${input.role}: oval face, short dark hair, clean-shaven, ` +
      'no glasses, forties, medium build, dark suit and open-collar shirt',
    guardrail: DEFAULT_GUARDRAIL,
  }
}

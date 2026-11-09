import {
  MECHANISM_KEYS,
  MECHANISMS_PER_DESIGN_MAX,
  PROPOSAL_DESCRIPTION_MAX,
  PROPOSAL_NAME_MAX,
  PROPOSAL_SLOT_MAX_MS,
  PROPOSAL_SLOT_MIN_MS,
  PROPOSAL_WHY_MAX,
  STEER_PHRASES_MAX,
  TECHNIQUE_KEY_MAX,
  TechniqueProposalAnswerSchema,
  ValidationError,
  isHouseTechnique,
  mechanismName,
} from '@boom-busters/schemas'
import type {
  ChannelTechnique,
  Mechanism,
  MotionIdentity,
  TechniqueProposalAnswer,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { claimedBySteer, hasNegator } from '../exemplars/technique'
import { outputBudget, type LLMTaskRequest } from '../llm/types'
import { motionIdentityBlock } from './graphics'
import { parseJsonCompletion } from './json'
import type { ReadingForDraft } from './motion'
import { readingBlock } from './storyboard'

/**
 * The technique proposal (spec 2026-11-04, section 8.5, second paragraph):
 * one text call on the graphics route, before a derivation's loop, that
 * reads the mechanism references and answers either a technique of this
 * channel's own (a key, a name, a one-line description, the steer phrases
 * that reach it, the mechanisms it is built on and a synthetic slot) or
 * none, with the reason. The proposed technique is then derived like any
 * other; approved, its key joins the channel's techniques in use.
 */

export const TECHNIQUE_PROPOSAL_OUTPUT_TOKENS = 1200
/** For the estimate shown before a launch. */
export const TECHNIQUE_PROPOSAL_INPUT_TOKENS = 5000

export interface TechniqueProposalInput {
  motion: MotionIdentity
  /** The mechanism references, read and not negative. */
  readings: readonly ReadingForDraft[]
  catalogue: readonly { technique: string; description: string; mechanisms: readonly Mechanism[] }[]
  channelTechniques: readonly ChannelTechnique[]
  /** Why the previous proposal was refused. */
  rejection?: string
}

const SYSTEM = `You read a video channel's mechanism references and decide whether they carry a move no technique covers.
A technique is a kind of motion graphic the designer is shown one finished example of. The catalogue
lists the house techniques; the channel may also have techniques of its own. Each mechanism reference
names, in its carry-over line and its reading, a move the owner wants borrowed as grammar.
If every move the references carry is already covered by a technique in the catalogue or among the
channel's own, answer {"proposal": null, "why": "..."} and say which technique covers each move.
Otherwise propose one technique, the one the references ask for most clearly, as JSON with the keys in this order:
{"proposal": {"key": "...", "name": "...", "description": "...", "steerPhrases": ["..."], "mechanisms": ["..."], "slot": {"durationMs": 6000, "words": [{"text": "...", "atMs": 0}], "intent": "..."}, "fromReference": "..."}, "why": "..."}
- "key": lower-case words joined by hyphens, under ${TECHNIQUE_KEY_MAX} characters, not a key in the catalogue or among the channel's own.
- "name": the technique in words, under ${PROPOSAL_NAME_MAX} characters.
- "description": one line under ${PROPOSAL_DESCRIPTION_MAX} characters saying what the graphic does, as the catalogue describes its techniques.
- "steerPhrases": one to ${STEER_PHRASES_MAX} phrases of two to four plain words a producer would type to ask for this technique, naming the move and not any house technique; no single words.
- "mechanisms": one to ${MECHANISMS_PER_DESIGN_MAX} keys from the list, the moves the design is built on.
- "slot": a synthetic slot for the channel's own example: ${PROPOSAL_SLOT_MIN_MS / 1000} to ${PROPOSAL_SLOT_MAX_MS / 1000} seconds, its narration as words on the clock in order and inside the slot, in this channel's register, and the intent the viewer must take away.
- "fromReference": the title of the reference the move came from.
- "why": under ${PROPOSAL_WHY_MAX} characters: the move, where it was seen, and why no technique covers it.
A reference is grammar to learn from, never content to copy. Use no dash characters.`

const MECHANISMS_LIST = `The mechanisms, by key: ${MECHANISM_KEYS.join(', ')}.`

export function buildTechniqueProposalRequest(input: TechniqueProposalInput): LLMTaskRequest {
  const guide = input.motion.styleGuideMd.trim()
  const catalogue = input.catalogue
    .map(
      (entry) =>
        `- ${entry.technique}: ${entry.description}` +
        (entry.mechanisms.length > 0
          ? ` (built on ${entry.mechanisms.map(mechanismName).join(', ')})`
          : ''),
    )
    .join('\n')
  const own =
    input.channelTechniques.length === 0
      ? 'The channel has no techniques of its own yet.'
      : `The channel's own techniques:\n${input.channelTechniques
          .map(
            (entry) =>
              `- ${entry.technique}: ${entry.description} (reached by ${entry.steerPhrases
                .map((phrase) => `'${phrase}'`)
                .join(', ')})`,
          )
          .join('\n')}`
  const readings =
    input.readings.length === 0
      ? 'No mechanism reference is read.'
      : `The mechanism references, by their readings:\n\n${input.readings
          .map(readingBlock)
          .join('\n\n')}`
  const content = [
    input.rejection ? `The previous proposal was refused: ${input.rejection}` : '',
    motionIdentityBlock(input.motion).trim(),
    guide ? `The channel's style guide:\n${guide}` : '',
    MECHANISMS_LIST,
    `The catalogue:\n${catalogue}`,
    own,
    readings,
    'Decide, and answer.',
  ]
    .filter(Boolean)
    .join('\n\n')
  return {
    task: 'graphics',
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    maxTokens: outputBudget(TECHNIQUE_PROPOSAL_OUTPUT_TOKENS),
  }
}

/**
 * The answer through its schema, then held to what the channel already
 * holds: a key in the catalogue or among the channel's own, or a phrase the
 * house steer list already claims, is a refused answer the retry carries.
 */
export function parseTechniqueProposal(
  text: string,
  /** Every key the channel holds or ticked, and its own techniques with their phrases. */
  taken: { keys: readonly string[]; techniques?: readonly ChannelTechnique[] },
): TechniqueProposalAnswer {
  // The key is checked on the raw answer, before the schema's own refusal of
  // a house key, so the retry carries the reason in words.
  const raw = parseJsonCompletion(text, z.looseObject({}), 'technique proposal')
  const rawProposal = raw['proposal']
  const rawKey =
    rawProposal && typeof rawProposal === 'object'
      ? (rawProposal as Record<string, unknown>)['key']
      : undefined
  if (typeof rawKey === 'string' && (isHouseTechnique(rawKey) || taken.keys.includes(rawKey))) {
    throw new ValidationError(`The key ${rawKey} is already a technique`, {
      field: 'technique proposal',
    })
  }
  const answer = parseJsonCompletion(text, TechniqueProposalAnswerSchema, 'technique proposal')
  const proposal = answer.proposal
  if (!proposal) return answer
  for (const phrase of proposal.steerPhrases) {
    const claimed =
      claimedBySteer(phrase) ??
      taken.techniques?.find((entry) => entry.steerPhrases.includes(phrase))?.technique
    if (claimed) {
      throw new ValidationError(`The phrase "${phrase}" already reaches ${claimed}`, {
        field: 'technique proposal',
      })
    }
    if (hasNegator(phrase)) {
      throw new ValidationError(
        `The phrase "${phrase}" contains a negation word, which a steer reads as a refusal`,
        { field: 'technique proposal' },
      )
    }
  }
  return answer
}

/** A reading the proposal may use: a mechanism reference, not a negative one, read. The same test gates the tick and the call. */
export function isReadMechanismReading(
  entry: Pick<ReadingForDraft, 'purpose' | 'negative' | 'reading'>,
): boolean {
  return entry.purpose === 'mechanism' && !entry.negative && entry.reading !== null
}

/** Words spread evenly from `fromMs`, `stepMs` apart. */
const spoken = (text: string, fromMs: number, stepMs: number) =>
  text.split(' ').map((word, index) => ({ text: word, atMs: fromMs + index * stepMs }))

/** Mock mode's answer: a technique from the first mechanism reference that is read and not negative, else none. */
export function mockTechniqueProposal(
  readings: readonly ReadingForDraft[],
): TechniqueProposalAnswer {
  const source = readings.find(isReadMechanismReading)
  if (!source) return { proposal: null, why: '[mock] no mechanism reference is read' }
  return {
    proposal: {
      key: 'mock-move',
      name: 'Mock move',
      description: `[mock] the move carried over from "${source.title}"`,
      steerPhrases: ['mock move'],
      mechanisms: ['persistent-actor'],
      slot: {
        durationMs: 6000,
        words: spoken('The move carries the whole slot.', 200, 450),
        intent: 'The move is the point.',
      },
      fromReference: source.title,
    },
    why: '[mock] proposed from the first mechanism reference',
  }
}

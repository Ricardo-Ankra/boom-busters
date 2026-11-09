import { z } from 'zod'
import { PLAN_INTENT_MAX, PLAN_WORDS_MAX } from './channel-exemplars'
import { MECHANISMS_PER_DESIGN_MAX, MechanismSchema } from './mechanisms'
import { ChannelTechniqueKeySchema, TechniqueKeySchema } from './techniques'

/**
 * A channel's own techniques (spec 2026-11-04, section 8.5, second
 * paragraph): a derivation may propose a technique from a mechanism
 * reference whose carry-over names a move no catalogue technique covers.
 * The proposal is stored on the channel exemplar built from it, and its
 * key joins the channel's techniques in use on approval. Everywhere a
 * technique key can be the channel's own, it is a validated string, not
 * the `TECHNIQUES` enum; the house catalogue itself does not change.
 */

export {
  ChannelTechniqueKeySchema,
  TECHNIQUE_KEY_MAX,
  TECHNIQUE_KEY_MIN,
  TECHNIQUE_KEY_PATTERN,
  TechniqueKeySchema,
  isHouseTechnique,
} from './techniques'
export type { TechniqueKey } from './techniques'

/**
 * A steer phrase: two to four plain words, so an ordinary instruction never
 * picks a technique (the house list's own rule). Lower-cased, since the
 * match is case-insensitive.
 */
export const STEER_PHRASE_WORDS_MIN = 2
export const STEER_PHRASE_WORDS_MAX = 4
export const STEER_PHRASES_MAX = 4
export const SteerPhraseSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?: [a-z0-9]+){1,3}$/, 'a steer phrase is two to four plain words')

export const PROPOSAL_NAME_MAX = 40
export const PROPOSAL_DESCRIPTION_MAX = 160
export const PROPOSAL_WHY_MAX = 600
export const PROPOSAL_SLOT_MIN_MS = 3000
export const PROPOSAL_SLOT_MAX_MS = 12000

/** The technique the derivation proposes: its key, its words, the phrases that reach it, its slot. */
export const TechniqueProposalSchema = z
  .object({
    key: ChannelTechniqueKeySchema,
    name: z.string().trim().min(1).max(PROPOSAL_NAME_MAX),
    description: z.string().trim().min(1).max(PROPOSAL_DESCRIPTION_MAX),
    steerPhrases: z.array(SteerPhraseSchema).min(1).max(STEER_PHRASES_MAX),
    mechanisms: z.array(MechanismSchema).min(1).max(MECHANISMS_PER_DESIGN_MAX),
    slot: z.object({
      durationMs: z.number().int().min(PROPOSAL_SLOT_MIN_MS).max(PROPOSAL_SLOT_MAX_MS),
      words: z
        .array(z.object({ text: z.string().trim().min(1), atMs: z.number().int().min(0) }))
        .min(1)
        .max(PLAN_WORDS_MAX),
      intent: z.string().trim().min(1).max(PLAN_INTENT_MAX),
    }),
    /** The title of the reference it came from. */
    fromReference: z.string().trim().min(1).max(120),
  })
  .superRefine((proposal, ctx) => {
    const { words, durationMs } = proposal.slot
    if (words.some((word) => word.atMs >= durationMs)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slot', 'words'],
        message: "a word sits past the slot's end",
      })
    }
    if (words.some((word, index) => index > 0 && word.atMs < words[index - 1]!.atMs)) {
      ctx.addIssue({
        code: 'custom',
        path: ['slot', 'words'],
        message: 'the words are not in order on the clock',
      })
    }
    if (new Set(proposal.steerPhrases).size !== proposal.steerPhrases.length) {
      ctx.addIssue({ code: 'custom', path: ['steerPhrases'], message: 'a phrase is named twice' })
    }
  })
export type TechniqueProposal = z.infer<typeof TechniqueProposalSchema>

/** The call's answer: one technique, or none with the reason. */
export const TechniqueProposalAnswerSchema = z.object({
  proposal: TechniqueProposalSchema.nullable(),
  why: z.string().trim().min(1).max(PROPOSAL_WHY_MAX),
})
export type TechniqueProposalAnswer = z.infer<typeof TechniqueProposalAnswerSchema>

/** What the propose step did, on the derivation row. */
export const PROPOSAL_STATES = ['none', 'proposed', 'failed', 'stopped-at-cap'] as const
export type ProposalState = (typeof PROPOSAL_STATES)[number]
export const DerivationProposalSchema = z.object({
  state: z.enum(PROPOSAL_STATES),
  technique: TechniqueKeySchema.nullable(),
  reason: z.string().max(500).nullable(),
})
export type DerivationProposal = z.infer<typeof DerivationProposalSchema>

/** What `techniqueFor` and the Motion tab read of a channel's own technique. */
export const ChannelTechniqueSchema = z.object({
  technique: ChannelTechniqueKeySchema,
  description: z.string(),
  steerPhrases: z.array(SteerPhraseSchema).min(1).max(STEER_PHRASES_MAX),
})
export type ChannelTechnique = z.infer<typeof ChannelTechniqueSchema>

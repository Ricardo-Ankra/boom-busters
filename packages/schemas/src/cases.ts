import { z } from 'zod'

/**
 * Provider IO for the Case Library's `Suggest cases` button (spec section
 * 11.3), and the shape the triage table renders.
 *
 * Two rules are enforced here rather than trusted to the prompt, because a
 * model that has been told twice still gets it wrong occasionally and a draft
 * row is about to be shown to a human as a real proposal:
 *
 *  - `category` must be one of the five the data model knows. An invented
 *    sixth category cannot be inserted, so it fails here, loudly, instead of
 *    at the database.
 *  - `priorityScore` is a whole number from 0 to 100. A model asked for a
 *    score will occasionally answer 9.5 or 1000; the parser rounds and clamps
 *    those before this schema sees them, with a notice (decision 293), and a
 *    score of "high" still fails here.
 */

export const CASE_CATEGORIES = ['collapse', 'con', 'meltdown', 'turnaround', 'empire'] as const
export const CaseCategorySchema = z.enum(CASE_CATEGORIES)
export type CaseCategoryName = z.infer<typeof CaseCategorySchema>

/**
 * A suggestion's limits (decision 293): one source for the schema, the
 * prompt that states them and the repair that fits an answer to them.
 */
export const CASE_TITLE_MIN = 3
export const CASE_TITLE_MAX = 200
export const CASE_ANGLE_MIN = 10
export const CASE_ANGLE_MAX = 2000
export const CASE_DEMAND_NOTES_MAX = 2000
export const CASE_LINKS_MAX = 10
export const CASE_LINK_NOTE_MAX = 500
export const CASE_PRIORITY_MIN = 0
export const CASE_PRIORITY_MAX = 100
export const CASE_SUGGESTIONS_MAX = 20

export const CaseSuggestionSchema = z.object({
  title: z.string().min(CASE_TITLE_MIN).max(CASE_TITLE_MAX),
  category: CaseCategorySchema,
  /** The angle that makes this worth 15 minutes rather than a headline. */
  angle: z.string().min(CASE_ANGLE_MIN).max(CASE_ANGLE_MAX),
  /** Why an audience is already looking for this: the demand evidence. */
  demandNotes: z.string().max(CASE_DEMAND_NOTES_MAX).optional(),
  /** Existing videos on the subject, so the angle can be differentiated. */
  competitorLinks: z
    .array(z.object({ url: z.string().url(), note: z.string().max(CASE_LINK_NOTE_MAX).optional() }))
    .max(CASE_LINKS_MAX)
    .optional(),
  priorityScore: z.number().int().min(CASE_PRIORITY_MIN).max(CASE_PRIORITY_MAX),
})
export type CaseSuggestion = z.infer<typeof CaseSuggestionSchema>

export const CaseSuggestionsSchema = z.object({
  suggestions: z.array(CaseSuggestionSchema).min(1).max(CASE_SUGGESTIONS_MAX),
})
export type CaseSuggestions = z.infer<typeof CaseSuggestionsSchema>

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
 *  - `priorityScore` is clamped to 0-100. A model asked for a score will
 *    occasionally answer 9.5, "high", or 1000.
 */

export const CASE_CATEGORIES = [
  'collapse',
  'con',
  'meltdown',
  'turnaround',
  'empire',
] as const
export const CaseCategorySchema = z.enum(CASE_CATEGORIES)
export type CaseCategoryName = z.infer<typeof CaseCategorySchema>

export const CaseSuggestionSchema = z.object({
  title: z.string().min(3).max(200),
  category: CaseCategorySchema,
  /** The angle that makes this worth 15 minutes rather than a headline. */
  angle: z.string().min(10).max(2000),
  /** Why an audience is already looking for this — the demand evidence. */
  demandNotes: z.string().max(2000).optional(),
  /** Existing videos on the subject, so the angle can be differentiated. */
  competitorLinks: z
    .array(z.object({ url: z.string().url(), note: z.string().max(500).optional() }))
    .max(10)
    .optional(),
  priorityScore: z.number().int().min(0).max(100),
})
export type CaseSuggestion = z.infer<typeof CaseSuggestionSchema>

export const CaseSuggestionsSchema = z.object({
  suggestions: z.array(CaseSuggestionSchema).min(1).max(20),
})
export type CaseSuggestions = z.infer<typeof CaseSuggestionsSchema>

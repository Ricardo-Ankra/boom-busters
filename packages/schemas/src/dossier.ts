import { z } from 'zod'

/**
 * Provider IO for the dossier-runner's research passes (build spec section 7).
 *
 * The channel's whole liability sits in this file. A claim that reaches a
 * script is a claim that gets narrated over footage to an audience, and the
 * subjects of these stories are real companies and living people. So the
 * schema is strict where it protects, not merely where it parses:
 *
 *  - A claim carries its own source. There is no "sourced" without a URL,
 *    enforced below rather than hoped for in the prompt.
 *  - `confidence` is a closed set the review UI knows how to render. An
 *    invented fourth value would render as nothing and read as "fine".
 *  - Adjudication is tracked separately from confidence, because "this is
 *    well sourced" and "a court has ruled on this" are different facts and
 *    the second is what decides whether the script must say "alleged".
 */

export const CLAIM_SOURCE_TYPES = ['court', 'regulator', 'major_outlet', 'book', 'other'] as const
export const ClaimSourceTypeSchema = z.enum(CLAIM_SOURCE_TYPES)
export type ClaimSourceTypeName = z.infer<typeof ClaimSourceTypeSchema>

export const CLAIM_CONFIDENCES = ['sourced', 'single_source', 'unverified'] as const
export const ClaimConfidenceSchema = z.enum(CLAIM_CONFIDENCES)
export type ClaimConfidenceName = z.infer<typeof ClaimConfidenceSchema>

/**
 * A source the model offered, kept only if it is genuinely a web address.
 *
 * Asked for a `sourceUrl`, a model will often give a citation instead — "Munich
 * court judgment, 2021", "FT, June 2020", "N/A". Rejecting the whole research
 * pass over that was wrong twice over: it threw away a good timeline because
 * one field was prose, and it did so *after* paying for the completion.
 *
 * So a value that does not parse as an http(s) URL is dropped rather than
 * fatal. What is not softened is the consequence — see `DraftClaimSchema`,
 * where losing the URL costs the claim its confidence.
 */
/**
 * A search engine is where you LOOK for a source, not a source. A model that
 * half-remembers where something was reported will offer a google.com search
 * link, which renders on the review screen as an authoritative-looking
 * citation that cites nothing. Dropped like any other non-source, which
 * downgrades the claim to unverified — the honest state for "go and find it".
 */
const SEARCH_ENGINE_HOSTS = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/i

function usableSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const parsed = new URL(value.trim())
    // Only http(s): a `file:` or `javascript:` "source" is not one, and this
    // string is rendered as a link on the review screen.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    if (SEARCH_ENGINE_HOSTS.test(parsed.hostname)) return undefined
    return value.trim()
  } catch {
    return undefined
  }
}

const SourceUrlSchema = z.preprocess(usableSourceUrl, z.string().optional())

export const DraftClaimSchema = z
  .object({
    text: z.string().trim().min(10).max(1000),
    sourceUrl: SourceUrlSchema,
    sourceType: ClaimSourceTypeSchema,
    confidence: ClaimConfidenceSchema,
    /**
     * Whether a court or regulator has actually ruled. Drives the self-check
     * pass's "'alleged' missing for non-adjudicated claim" warning.
     */
    adjudicated: z.boolean(),
  })
  /**
   * A claim with no usable source is unverified, whatever the model called it,
   * and it is not adjudicated either.
   *
   * This replaces two refinements that rejected the batch instead. Rejecting
   * was the stricter-looking option and the weaker one: it failed the whole
   * research pass, and a retry would produce the same shape again. Downgrading
   * keeps the claim, states the truth about it, and hands it to the reviewer as
   * an amber row that blocks approval until they source or quarantine it —
   * which is the mechanism that already exists for exactly this.
   */
  .transform((claim) =>
    claim.sourceUrl === undefined
      ? { ...claim, confidence: 'unverified' as const, adjudicated: false }
      : claim,
  )
export type DraftClaim = z.infer<typeof DraftClaimSchema>

/**
 * One dated event on the case timeline.
 *
 * Unlike a claim, a timeline entry is context rather than an assertion the
 * script will narrate, so an unsourced one is simply an unsourced one.
 */
export const TimelineEventSchema = z.object({
  /** Free text rather than a date: "March 2001", "late 2019" are all real. */
  when: z.string().trim().min(3).max(100),
  what: z.string().trim().min(10).max(1000),
  sourceUrl: SourceUrlSchema,
})
export type TimelineEvent = z.infer<typeof TimelineEventSchema>

export const CaseBriefSchema = z.object({
  summary: z.string().trim().min(50).max(5000),
  /** Why this story turns — the moment the script builds toward. */
  turningPoint: z.string().trim().min(20).max(2000),
  /** Named people and organisations, so the script can be consistent. */
  principals: z.array(z.object({ name: z.string().min(2), role: z.string().min(2) })).max(30),
  /** What the research could not establish. Shown to the human, not hidden. */
  openQuestions: z.array(z.string().min(10)).max(20),
})
export type CaseBrief = z.infer<typeof CaseBriefSchema>

/**
 * Named `Research*` because M6 introduces `TimelineSchema` for the compiled
 * video timeline. Two different things called "timeline" in one codebase is a
 * bug waiting for whoever imports the wrong one.
 */
export const ResearchTimelineSchema = z.object({
  events: z.array(TimelineEventSchema).min(1).max(60),
})

export const ClaimsSchema = z.object({
  claims: z.array(DraftClaimSchema).min(1).max(120),
})

/**
 * The fourth research pass: the brief's open questions, answered (decision
 * 201). `answer: null` is a first-class value — "the record does not say" is
 * an honest finding, and forcing a string here would force an invention. An
 * answer under ten characters is treated the same way: "unknown" and "n/a"
 * are refusals wearing a string type.
 */
export const ResearchAnswerSchema = z.object({
  question: z.string().trim().min(10).max(1000),
  answer: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length >= 10 ? value.trim() : null),
    z.string().max(3000).nullable(),
  ),
  sourceUrl: SourceUrlSchema,
})
export type ResearchAnswer = z.infer<typeof ResearchAnswerSchema>

export const ResearchAnswersSchema = z.object({
  answers: z.array(ResearchAnswerSchema).max(40),
  /**
   * Facts surfaced while answering, in the same shape as the claims pass —
   * an answer the script might narrate must be checkable the same way.
   */
  claims: z.array(DraftClaimSchema).max(40).default([]),
})
export type ResearchAnswers = z.infer<typeof ResearchAnswersSchema>

/**
 * How many claims may be unsourced before the dossier is not worth reviewing.
 *
 * Not a hard failure — the review UI exists precisely so a human can verify or
 * quarantine them. But a research pass that returns mostly unverified claims
 * has not done the job, and saying so at the gate is more useful than handing
 * over 40 amber rows without comment.
 */
export const UNVERIFIED_CLAIM_WARNING_RATIO = 0.4

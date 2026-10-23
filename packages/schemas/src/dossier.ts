import { z } from 'zod'

/**
 * Provider IO for the dossier-runner's research passes (build spec section 7).
 *
 * The channel's whole liability sits in this file. A claim that reaches a
 * script is a claim that gets narrated over footage to an audience, and the
 * subjects of these stories are real companies and living people. So the
 * schema is strict where it protects, not merely where it parses:
 *
 *  - A claim carries its own evidence: one to three supports, each a document
 *    number and a quote. The app resolves the number to a stored document and
 *    finds the quote in its text, so a citation is checked, not trusted.
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
 * The research passes' limits (decision 293): one source for the schemas
 * below, the prompts that state them and the parsers that repair to them.
 * Free text over its limit is trimmed. A date label, a claim's text and an
 * answer's echoed question are facts: an item whose fact runs over is
 * dropped, never cut.
 */
export const DOSSIER_SUMMARY_MAX = 5000
export const DOSSIER_TURNING_POINT_MAX = 2000
export const DOSSIER_PRINCIPALS_MAX = 30
export const DOSSIER_OPEN_QUESTIONS_MAX = 20
export const DOSSIER_STATUS_MAX = 600
export const DOSSIER_EVENT_WHEN_MAX = 100
export const DOSSIER_EVENT_WHAT_MAX = 1000
export const DOSSIER_EVENTS_MAX = 60
export const DOSSIER_CLAIM_TEXT_MAX = 1000
export const DOSSIER_CLAIMS_MAX = 120

/** The back-test's currency gate: a recent-outcome case's status is dated within this many days of the run. */
export const BACKTEST_CURRENT_WITHIN_DAYS = 540
export const DOSSIER_QUESTION_MAX = 1000
export const DOSSIER_ANSWER_MAX = 3000
export const DOSSIER_ANSWERS_MAX = 40
/**
 * Per part of the answers pass, which runs as two parts for the same step
 * limit the claims pass does (see `DOSSIER_CLAIMS_PER_PASS`).
 */
export const DOSSIER_ANSWER_CLAIMS_MAX = 20

/**
 * Limits of the grounded pipeline (research from a gathered corpus). The
 * corpus and document budgets are in tokens because the model's context is;
 * the quote cap is in characters because a quote is matched against text.
 */
export const DOSSIER_CORPUS_TOKENS = 120_000
export const DOSSIER_DOCUMENT_TOKENS = 12_000
export const DOSSIER_QUOTE_MAX = 300
/** A quote shorter than this (folded) matches too easily to prove anything. */
export const DOSSIER_QUOTE_MIN_FOLDED = 20
export const DOSSIER_SUPPORTS_MAX = 3
export const DOSSIER_SERIES_POINTS_MAX = 24
/**
 * The cap per part of the claims pass, which runs as two parts: forty in one
 * 12,000-token answer took up to 319 s live, over the 300 s step limit, so
 * each part writes twenty in an 8,000-token answer and the pass keeps forty.
 */
export const DOSSIER_CLAIMS_PER_PASS = 20
export const DOSSIER_SCENES_MAX = 60
export const DOSSIER_CAST_MAX = 30
export const DOSSIER_TOLD_ALREADY_MAX = 30
export const DOCUMENT_BODY_CAP_BYTES = 4 * 1024 * 1024
/** Share of the corpus budget each tier may fill, so one tier cannot crowd out the rest. */
export const DOSSIER_TIER_SHARES = { 1: 0.25, 2: 0.3, 3: 0.15, 4: 0.1, 5: 0.2 } as const
/**
 * References the gather takes from each person's Wikipedia article. A
 * founder's article carries the aftermath (sentence, appeal, prison) that the
 * company's article often does not.
 */
export const PERSON_REFERENCE_CAP = 20

/**
 * What a gathered document is. The tier ranks how much a document's say-so
 * weighs: primary filings and the company's own archived pages first, then
 * reporting, video, third-party figures, and regulator and court records,
 * which sit in their own tier because they are the only documents that can
 * settle a legal status.
 */
export const DOCUMENT_KINDS = [
  'filing',
  'web-archive',
  'press-release',
  'reporting',
  'video',
  'figures',
  'regulator',
  'court',
] as const
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS)
export type DocumentKind = z.infer<typeof DocumentKindSchema>

export const DOCUMENT_TIERS: Record<DocumentKind, 1 | 2 | 3 | 4 | 5> = {
  filing: 1,
  'web-archive': 1,
  'press-release': 1,
  reporting: 2,
  video: 3,
  figures: 4,
  regulator: 5,
  court: 5,
}

/**
 * Whether a court or regulator has actually ruled, tracked apart from how well
 * a claim is sourced. Drives the self-check pass's "'alleged' missing" warning.
 */
export const LEGAL_STATUSES = ['ruled', 'alleged', 'none'] as const
export const LegalStatusSchema = z.enum(LEGAL_STATUSES)
export type LegalStatus = z.infer<typeof LegalStatusSchema>

/**
 * The words of a verdict (decision 6). A `ruled` status resting on reporting
 * or a video is kept when the claim or one of its quotes says one of these,
 * as a whole phrase: a conviction reported by a major outlet is a ruling, and
 * a charge is not.
 */
export const VERDICT_WORDS = [
  'convicted',
  'found guilty',
  'pleaded guilty',
  'pled guilty',
  'sentenced',
  'acquitted',
  'fined',
  'banned',
  'ordered to pay',
  'ruled',
] as const

/** A document number from the numbered corpus plus the words that prove the point. */
export const SupportSchema = z.object({
  doc: z.number().int().min(1),
  quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX),
})
export type Support = z.infer<typeof SupportSchema>

export const LegalSchema = z.object({
  status: LegalStatusSchema,
  /** Year, month or day: a filing often dates a ruling only to the month. */
  date: z.string().regex(/^\d{4}(-\d{2}){0,2}$/),
  doc: z.number().int().min(1),
})

/**
 * A figure over time. `asWritten` is the number as the document prints it
 * ("EUR 1.9 billion"), kept beside the parsed `value` so a unit or scale slip
 * in parsing is visible on review rather than silently narrated.
 */
export const SeriesPointSchema = z.object({
  at: z.string().trim().min(1).max(40),
  value: z.number(),
  asWritten: z.string().trim().min(1).max(40),
})
export const SeriesSchema = z.object({
  label: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(40),
  currency: z.string().trim().max(10).nullable(),
  points: z.array(SeriesPointSchema).min(1).max(DOSSIER_SERIES_POINTS_MAX),
})
export type Series = z.infer<typeof SeriesSchema>

export const ResearchClaimSchema = z.object({
  text: z.string().trim().min(10).max(DOSSIER_CLAIM_TEXT_MAX),
  supports: z.array(SupportSchema).min(1).max(DOSSIER_SUPPORTS_MAX),
  legal: LegalSchema.nullable().default(null),
  series: SeriesSchema.nullable().default(null),
})
export type ResearchClaim = z.infer<typeof ResearchClaimSchema>

/**
 * Empty is allowed: the claims pass runs in parts, and a part whose share of
 * the documents leads no claim must be able to say so. `parseClaims` still
 * refuses a list that repairs emptied, and the research step refuses a
 * dossier whose parts together found none.
 */
export const ClaimsSchema = z.object({
  claims: z.array(ResearchClaimSchema).max(DOSSIER_CLAIMS_PER_PASS),
})

/**
 * A person or organisation the script follows, with what they were after.
 * Named `BriefCast*` because `cast.ts` already owns `CastMemberSchema` (the
 * visual cast with reference photos), and both are re-exported from the index.
 */
export const BriefCastMemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(200),
  wanted: z.string().trim().min(10).max(500),
  /** A scene that shows them wanting it, if the corpus has one. */
  scene: SupportSchema.nullable().default(null),
})

/** A beat earlier coverage already told, so the script can avoid retelling it. */
export const ToldAlreadySchema = z.object({
  beat: z.string().trim().min(10).max(500),
  doc: z.number().int().min(1),
  quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX),
})

export const CaseBriefSchema = z.object({
  summary: z.string().trim().min(50).max(DOSSIER_SUMMARY_MAX),
  /** Why this story turns: the moment the script builds toward. */
  turningPoint: z.string().trim().min(20).max(DOSSIER_TURNING_POINT_MAX),
  cast: z.array(BriefCastMemberSchema).max(DOSSIER_CAST_MAX),
  toldAlready: z.array(ToldAlreadySchema).max(DOSSIER_TOLD_ALREADY_MAX).default([]),
  /** What the research could not establish. Shown to the human, not hidden. */
  openQuestions: z.array(z.string().min(10)).max(DOSSIER_OPEN_QUESTIONS_MAX),
  /** Where the story stands today, dated. Null for briefs written before this existed. */
  currentStatus: z
    .object({
      asOf: z.string().regex(/^\d{4}(-\d{2}){0,2}$/),
      text: z.string().trim().min(20).max(DOSSIER_STATUS_MAX),
    })
    .nullable()
    .default(null),
})
export type CaseBrief = z.infer<typeof CaseBriefSchema>

/**
 * One dated scene on the case timeline. Named `Scene*` rather than timeline
 * because M6 introduces `TimelineSchema` for the compiled video timeline, and
 * two different things called "timeline" in one codebase is a bug waiting for
 * whoever imports the wrong one.
 */
export const SceneSchema = z.object({
  /** Free text rather than a date: "March 2001", "late 2019" are all real. */
  when: z.string().trim().min(3).max(DOSSIER_EVENT_WHEN_MAX),
  who: z.string().trim().min(2).max(200),
  what: z.string().trim().min(10).max(DOSSIER_EVENT_WHAT_MAX),
  why: z.string().trim().min(10).max(500),
  doc: z.number().int().min(1),
  quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX),
})
export type Scene = z.infer<typeof SceneSchema>

export const ScenesSchema = z.object({
  scenes: z.array(SceneSchema).min(1).max(DOSSIER_SCENES_MAX),
})

/**
 * The fourth research pass: the brief's open questions, answered (decision
 * 201). `answer: null` is a first-class value — "the record does not say" is
 * an honest finding, and forcing a string here would force an invention. An
 * answer under ten characters is treated the same way: "unknown" and "n/a"
 * are refusals wearing a string type.
 */
export const ResearchAnswerSchema = z.object({
  /**
   * 1-based number of the brief question, as numbered in the request. The
   * renderer places answers by this, not by comparing question text: models
   * paraphrase the question they were given often enough that a real answer
   * matched by text alone can fail to place and vanish from the dossier —
   * which is exactly what happened the first time this pass ran live.
   * Optional so a model that forgets it does not fail the whole parse; the
   * renderer then falls back to text matching.
   */
  index: z.number().int().min(1).max(40).optional(),
  question: z.string().trim().min(10).max(DOSSIER_QUESTION_MAX),
  answer: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length >= 10 ? value.trim() : null),
    z.string().max(DOSSIER_ANSWER_MAX).nullable(),
  ),
  /** The document the answer rests on; the app resolves it to a stored one. */
  doc: z.number().int().min(1).optional(),
})
export type ResearchAnswer = z.infer<typeof ResearchAnswerSchema>

export const ResearchAnswersSchema = z.object({
  answers: z.array(ResearchAnswerSchema).max(DOSSIER_ANSWERS_MAX),
  /**
   * Facts surfaced while answering, in the same shape as the claims pass —
   * an answer the script might narrate must be checkable the same way.
   */
  claims: z.array(ResearchClaimSchema).max(DOSSIER_ANSWER_CLAIMS_MAX).default([]),
})
export type ResearchAnswers = z.infer<typeof ResearchAnswersSchema>

/**
 * What the app stores once a pass's document numbers are resolved and each
 * quote has been looked for in the document text. `found: false` is kept, not
 * dropped: an unlocated quote is the reviewer's cue, and hiding it would
 * restore exactly the trust this shape exists to remove.
 */
export const GroundedSupportSchema = z.object({
  documentId: z.string(),
  rank: z.number().int().min(1),
  quote: z.string(),
  found: z.boolean(),
  offset: z.number().int().nullable(),
  locatorSeconds: z.number().int().nullable(),
  url: z.string(),
  archivedUrl: z.string().nullable(),
})
export type GroundedSupport = z.infer<typeof GroundedSupportSchema>

export const GroundedClaimSchema = z.object({
  text: z.string(),
  sourceUrl: z.string().nullable(),
  sourceType: ClaimSourceTypeSchema,
  confidence: ClaimConfidenceSchema,
  legalStatus: LegalStatusSchema,
  legalStatusDate: z.string().nullable(),
  legalStatusDocumentId: z.string().nullable(),
  series: SeriesSchema.nullable(),
  supports: z.array(GroundedSupportSchema),
})
export type GroundedClaim = z.infer<typeof GroundedClaimSchema>

export const GroundedRefSchema = z.object({
  documentId: z.string().nullable(),
  url: z.string().nullable(),
  found: z.boolean(),
  locatorSeconds: z.number().int().nullable(),
  quote: z.string().nullable(),
})
export type GroundedRef = z.infer<typeof GroundedRefSchema>

export const GroundedSceneSchema = SceneSchema.omit({ doc: true }).extend({
  ref: GroundedRefSchema,
})
export const GroundedCastMemberSchema = BriefCastMemberSchema.omit({ scene: true }).extend({
  ref: GroundedRefSchema.nullable(),
})
export const GroundedToldAlreadySchema = z.object({
  beat: ToldAlreadySchema.shape.beat,
  ref: GroundedRefSchema,
})
export const GroundedAnswerSchema = ResearchAnswerSchema.omit({ doc: true }).extend({
  ref: GroundedRefSchema.nullable(),
})

/** The identifiers the gatherer resolved for the subject, kept for later lookups. */
export const ResearchEntitySchema = z.object({
  qid: z.string().nullable(),
  titles: z.array(z.string()),
  cik: z.string().nullable(),
  ticker: z.string().nullable(),
  website: z.string().nullable(),
  people: z
    .array(z.object({ name: z.string(), qid: z.string().nullable(), title: z.string().nullable() }))
    .default([]),
  unresolved: z.boolean().default(false),
  subject: z.string().nullable().default(null),
})
export type ResearchEntity = z.infer<typeof ResearchEntitySchema>

export const GroundedResearchSchema = z.object({
  entity: ResearchEntitySchema,
  brief: z.object({
    summary: CaseBriefSchema.shape.summary,
    turningPoint: CaseBriefSchema.shape.turningPoint,
    cast: z.array(GroundedCastMemberSchema),
    toldAlready: z.array(GroundedToldAlreadySchema),
    openQuestions: CaseBriefSchema.shape.openQuestions,
    currentStatus: CaseBriefSchema.shape.currentStatus,
  }),
  scenes: z.array(GroundedSceneSchema),
  answers: z.array(GroundedAnswerSchema),
  corpus: z.object({ read: z.number().int(), unread: z.number().int(), failed: z.number().int() }),
})
export type GroundedResearch = z.infer<typeof GroundedResearchSchema>

/**
 * How many claims may be unsourced before the dossier is not worth reviewing.
 *
 * Not a hard failure — the review UI exists precisely so a human can verify or
 * quarantine them. But a research pass that returns mostly unverified claims
 * has not done the job, and saying so at the gate is more useful than handing
 * over 40 amber rows without comment.
 */
export const UNVERIFIED_CLAIM_WARNING_RATIO = 0.4

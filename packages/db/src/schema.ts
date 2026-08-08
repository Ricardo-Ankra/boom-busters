import { newId } from '@boom-busters/schemas'
import type { Settings } from '@boom-busters/schemas'
import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The complete data model from build spec section 5.
 *
 * Every table carries a ULID `id`, `createdAt` and `updatedAt`. Money is
 * `numeric(12,4)` — never a float, because the cost ledger feeds the budget
 * guard and rounding drift there means real spend.
 *
 * Tables belonging to later milestones (renders, shorts, analytics...) exist
 * from M1 so every milestone codes against a settled contract; they simply
 * have no query helpers until their milestone arrives.
 */

// ---------------------------------------------------------------------------
// Shared column builders
// ---------------------------------------------------------------------------

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId())

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

/** USD to four decimal places: a single Haiku call can cost $0.0003. */
const usd = (name: string) => numeric(name, { precision: 12, scale: 4 })

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * `turnaround` and `empire` support the phased scope broadening. No code
 * treats any category specially (spec section 5).
 */
export const caseCategoryEnum = pgEnum('case_category', [
  'collapse',
  'con',
  'meltdown',
  'turnaround',
  'empire',
])
export const caseStatusEnum = pgEnum('case_status', [
  'idea',
  'shortlisted',
  'in_production',
  'published',
  'retired',
])

export const projectStageEnum = pgEnum('project_stage', [
  'dossier',
  'script',
  'voice',
  'visuals',
  'assembly',
  'shorts',
  'publish',
  'done',
])
export const stageStatusEnum = pgEnum('stage_status', [
  'queued',
  'running',
  'awaiting_review',
  'approved',
  'failed',
  'cancelled',
])

export const sourceTypeEnum = pgEnum('source_type', [
  'court',
  'regulator',
  'major_outlet',
  'book',
  'other',
])
export const claimConfidenceEnum = pgEnum('claim_confidence', [
  'sourced',
  'single_source',
  'unverified',
])

export const scriptStatusEnum = pgEnum('script_status', ['draft', 'self_checked', 'approved'])
export const editTypeEnum = pgEnum('edit_type', ['human', 'regenerate'])

export const voiceTakeStatusEnum = pgEnum('voice_take_status', [
  'pending',
  'generated',
  'flagged',
  'approved',
])

/**
 * `hero` (AI video) is feature-flagged off at launch: the schema, brief type
 * and UI badge exist, but no video-generation adapter is built and the
 * shot-list prompt is told not to emit hero slots (spec section 5).
 */
export const shotTypeEnum = pgEnum('shot_type', [
  'stock',
  'archival',
  'still',
  'chart',
  'map',
  'hero',
])
export const shotStatusEnum = pgEnum('shot_status', ['unresolved', 'resolved', 'placeholder'])

export const assetKindEnum = pgEnum('asset_kind', ['image', 'video', 'music', 'logo'])

export const renderKindEnum = pgEnum('render_kind', ['master', 'short'])
export const renderStatusEnum = pgEnum('render_status', [
  'queued',
  'invoking',
  'rendering',
  'qc',
  'done',
  'failed',
  'cancelled',
])

export const shortEndingEnum = pgEnum('short_ending', ['loop', 'cta'])

export const publishTargetEnum = pgEnum('publish_target', ['master', 'short'])
export const publishStatusEnum = pgEnum('publish_status', [
  'draft',
  'scheduled',
  'uploading',
  'uploaded',
  'live',
  'failed',
])
export const privacyStatusEnum = pgEnum('privacy_status', ['private', 'unlisted', 'public'])

export const providerEnum = pgEnum('provider', [
  'anthropic',
  'openai',
  'google',
  'elevenlabs',
  'pexels',
  'pixabay',
  'fal',
  'hosted-alignment',
  'youtube',
  'remotion',
])
export const verifyStatusEnum = pgEnum('verify_status', ['ok', 'invalid', 'unchecked'])

export const runStatusEnum = pgEnum('run_status', [
  'running',
  'completed',
  'failed',
  'cancelled',
  'awaiting_gate',
])

// ---------------------------------------------------------------------------
// Settings (single row) and credentials
// ---------------------------------------------------------------------------

/**
 * Exactly one row, guarded by the `singleton` check. Behavioural
 * configuration lives here rather than in env so a model, budget or brand
 * change never needs a redeploy (spec section 4).
 */
export const settings = pgTable('settings', {
  id: text('id').primaryKey().default('singleton').$type<'singleton'>(),
  value: jsonb('value').notNull().$type<Settings>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: id(),
    provider: providerEnum('provider').notNull(),
    /** AES-256-GCM, keyed by SECRETS_ENCRYPTION_KEY. Never leaves the server. */
    encryptedKey: text('encrypted_key').notNull(),
    /** Last 4 characters, for the masked display `sk-...4f2a`. */
    keyHint: text('key_hint').notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    verifyStatus: verifyStatusEnum('verify_status').notNull().default('unchecked'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('provider_credentials_provider_key').on(t.provider)],
)

// ---------------------------------------------------------------------------
// Case library and projects
// ---------------------------------------------------------------------------

export const cases = pgTable(
  'cases',
  {
    id: id(),
    title: text('title').notNull(),
    category: caseCategoryEnum('category').notNull(),
    angle: text('angle'),
    demandNotes: text('demand_notes'),
    competitorLinks: jsonb('competitor_links')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<{ url: string; note?: string }[]>(),
    priorityScore: integer('priority_score').notNull().default(0),
    status: caseStatusEnum('status').notNull().default('idea'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('cases_status_idx').on(t.status), index('cases_priority_idx').on(t.priorityScore)],
)

export const projects = pgTable(
  'projects',
  {
    id: id(),
    caseId: text('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    stage: projectStageEnum('stage').notNull().default('dossier'),
    stageStatus: stageStatusEnum('stage_status').notNull().default('queued'),
    targetRuntimeMin: integer('target_runtime_min').notNull().default(18),
    inngestRunId: text('inngest_run_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('projects_case_idx').on(t.caseId),
    index('projects_stage_idx').on(t.stage, t.stageStatus),
  ],
)

// ---------------------------------------------------------------------------
// Dossier and claims — the traceability chain starts here (spec principle 7)
// ---------------------------------------------------------------------------

export const dossiers = pgTable(
  'dossiers',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contentMd: text('content_md').notNull().default(''),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('dossiers_project_key').on(t.projectId)],
)

export const claims = pgTable(
  'claims',
  {
    id: id(),
    dossierId: text('dossier_id')
      .notNull()
      .references(() => dossiers.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    sourceUrl: text('source_url'),
    sourceType: sourceTypeEnum('source_type').notNull().default('other'),
    confidence: claimConfidenceEnum('confidence').notNull().default('unverified'),
    /** Quarantined claims are excluded from the scripting prompt entirely. */
    quarantined: boolean('quarantined').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('claims_dossier_idx').on(t.dossierId, t.confidence)],
)

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export const scripts = pgTable(
  'scripts',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    status: scriptStatusEnum('status').notNull().default('draft'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('scripts_project_version_key').on(t.projectId, t.version)],
)

export const chapters = pgTable(
  'chapters',
  {
    id: id(),
    scriptId: text('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    estRuntimeSec: integer('est_runtime_sec').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('chapters_script_index_key').on(t.scriptId, t.index)],
)

/** The human-curation evidence trail (spec section 5 and risk table). */
export const scriptEdits = pgTable(
  'script_edits',
  {
    id: id(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    beforeText: text('before_text').notNull(),
    afterText: text('after_text').notNull(),
    editType: editTypeEnum('edit_type').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('script_edits_chapter_idx').on(t.chapterId)],
)

/** Script sentence -> dossier claim. Charts later reference claims by id too. */
export const claimRefs = pgTable(
  'claim_refs',
  {
    id: id(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    sentenceHash: text('sentence_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('claim_refs_unique').on(t.chapterId, t.claimId, t.sentenceHash),
    index('claim_refs_claim_idx').on(t.claimId),
  ],
)

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const voiceTakes = pgTable(
  'voice_takes',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    /** Paragraphs split deterministically on blank lines (spec section 7). */
    paragraphIndex: integer('paragraph_index').notNull(),
    provider: providerEnum('provider').notNull(),
    voiceId: text('voice_id').notNull(),
    r2Key: text('r2_key'),
    durationMs: integer('duration_ms'),
    status: voiceTakeStatusEnum('status').notNull().default('pending'),
    takeNumber: integer('take_number').notNull().default(1),
    costUsd: usd('cost_usd').notNull().default('0'),
    /** hash(projectId, chapterId, paragraphIndex, textHash, voiceId): re-runs are free. */
    idempotencyKey: text('idempotency_key').notNull(),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('voice_takes_idempotency_key').on(t.idempotencyKey, t.takeNumber),
    index('voice_takes_project_idx').on(t.projectId, t.status),
    index('voice_takes_paragraph_idx').on(t.chapterId, t.paragraphIndex),
  ],
)

// ---------------------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------------------

export const assets = pgTable(
  'assets',
  {
    id: id(),
    kind: assetKindEnum('kind').notNull(),
    r2Key: text('r2_key').notNull(),
    sourceUrl: text('source_url'),
    licence: text('licence').notNull(),
    /** Dedupe key: the same stock clip fetched twice is stored once. */
    contentHash: text('content_hash').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    attributionText: text('attribution_text'),
    /** Music only — powers the music picker on the preview screen. */
    moodTags: text('mood_tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('assets_content_hash_key').on(t.contentHash),
    index('assets_kind_idx').on(t.kind),
  ],
)

export const shotSlots = pgTable(
  'shot_slots',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    type: shotTypeEnum('type').notNull(),
    /** The full typed creative brief. Shape lands with the shot-list prompt in M5. */
    brief: jsonb('brief').notNull().$type<Record<string, unknown>>(),
    candidates: jsonb('candidates')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Record<string, unknown>[]>(),
    chosenAssetId: text('chosen_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    status: shotStatusEnum('status').notNull().default('unresolved'),
    startMs: integer('start_ms').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shot_slots_chapter_index_key').on(t.chapterId, t.index),
    index('shot_slots_project_idx').on(t.projectId, t.status),
  ],
)

// ---------------------------------------------------------------------------
// Assembly, render, shorts
// ---------------------------------------------------------------------------

export const timelines = pgTable(
  'timelines',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    /**
     * Validated against TimelineSchema (M6). Stores stable storage KEYS, never
     * presigned URLs — the broker materialises fresh URLs at invoke time, which
     * is what keeps "any timeline is re-renderable forever" true (section 8.2).
     */
    json: jsonb('json').notNull().$type<unknown>(),
    s3Key: text('s3_key'),
    compiledAt: timestamp('compiled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('timelines_project_version_key').on(t.projectId, t.version)],
)

export const shorts = pgTable(
  'shorts',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    description: text('description').notNull().default(''),
    /** chapterId + paragraph range, per spec section 5. */
    segmentRef: jsonb('segment_ref')
      .notNull()
      .$type<{ chapterId: string; fromParagraph: number; toParagraph: number }>(),
    ending: shortEndingEnum('ending').notNull().default('cta'),
    renderId: text('render_id'),
    /** "Set related video link in Studio" must be ticked before scheduling. */
    relatedLinkChecked: boolean('related_link_checked').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('shorts_project_idx').on(t.projectId)],
)

export const renders = pgTable(
  'renders',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    timelineVersion: integer('timeline_version').notNull(),
    kind: renderKindEnum('kind').notNull(),
    shortId: text('short_id').references(() => shorts.id, { onDelete: 'cascade' }),
    brokerRenderId: text('broker_render_id'),
    remotionRenderId: text('remotion_render_id'),
    status: renderStatusEnum('status').notNull().default('queued'),
    progressPct: integer('progress_pct').notNull().default(0),
    outputS3Key: text('output_s3_key'),
    qcReport: jsonb('qc_report').$type<Record<string, unknown>>(),
    costUsd: usd('cost_usd').notNull().default('0'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('renders_project_idx').on(t.projectId, t.status),
    index('renders_broker_idx').on(t.brokerRenderId),
  ],
)

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export const publishRecords = pgTable(
  'publish_records',
  {
    id: id(),
    targetType: publishTargetEnum('target_type').notNull(),
    /** projectId for a master, shortId for a Short. */
    targetId: text('target_id').notNull(),
    youtubeVideoId: text('youtube_video_id'),
    privacyStatus: privacyStatusEnum('privacy_status').notNull().default('private'),
    publishAt: timestamp('publish_at', { withTimezone: true }),
    /**
     * Canva PNGs. The first is set via thumbnails.set; the rest are kept for
     * manual Test & Compare, which has no API (spec section 9).
     */
    uploadedThumbKeys: text('uploaded_thumb_keys')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    status: publishStatusEnum('status').notNull().default('draft'),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /**
     * The idempotency guard against double upload, for masters AND each Short
     * (spec section 5). publish-runner transitions draft->uploading with an
     * UPDATE ... WHERE status='draft' against this row.
     */
    unique('publish_records_target_key').on(t.targetType, t.targetId),
  ],
)

// ---------------------------------------------------------------------------
// Cost, runs, analytics
// ---------------------------------------------------------------------------

export const costLedger = pgTable(
  'cost_ledger',
  {
    id: id(),
    provider: providerEnum('provider').notNull(),
    operation: text('operation').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    estimatedUsd: usd('estimated_usd').notNull().default('0'),
    actualUsd: usd('actual_usd'),
    meta: jsonb('meta')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cost_ledger_provider_month_idx').on(t.provider, t.occurredAt),
    index('cost_ledger_project_idx').on(t.projectId),
  ],
)

/** Mirror of Inngest run state so the activity drawer never depends on the
 * Inngest dashboard (spec section 12). */
export const runs = pgTable(
  'runs',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    inngestRunId: text('inngest_run_id'),
    functionName: text('function_name').notNull(),
    stage: projectStageEnum('stage'),
    status: runStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('runs_project_idx').on(t.projectId, t.status),
    index('runs_inngest_idx').on(t.inngestRunId),
  ],
)

export const runEvents = pgTable(
  'run_events',
  {
    id: id(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stepId: text('step_id'),
    kind: text('kind').notNull(),
    message: text('message'),
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('run_events_run_idx').on(t.runId, t.occurredAt)],
)

export const analyticsSnapshots = pgTable(
  'analytics_snapshots',
  {
    id: id(),
    videoId: text('video_id').notNull(),
    date: timestamp('date', { withTimezone: true }).notNull(),
    retentionCurve: jsonb('retention_curve').$type<{ pct: number; ratio: number }[]>(),
    ctrBySource: jsonb('ctr_by_source').$type<Record<string, number>>(),
    avgViewDurationSec: integer('avg_view_duration_sec'),
    views: integer('views'),
    rpm: usd('rpm'),
    shortsFeedStats: jsonb('shorts_feed_stats').$type<Record<string, number>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('analytics_video_date_key').on(t.videoId, t.date)],
)

// ---------------------------------------------------------------------------
// Auth.js tables (spec section 2: Auth.js, Google, one-email allowlist)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: id(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const casesRelations = relations(cases, ({ many }) => ({
  projects: many(projects),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  case: one(cases, { fields: [projects.caseId], references: [cases.id] }),
  dossier: one(dossiers),
  scripts: many(scripts),
  voiceTakes: many(voiceTakes),
  shotSlots: many(shotSlots),
  timelines: many(timelines),
  renders: many(renders),
  shorts: many(shorts),
  runs: many(runs),
}))

export const dossiersRelations = relations(dossiers, ({ one, many }) => ({
  project: one(projects, { fields: [dossiers.projectId], references: [projects.id] }),
  claims: many(claims),
}))

export const claimsRelations = relations(claims, ({ one, many }) => ({
  dossier: one(dossiers, { fields: [claims.dossierId], references: [dossiers.id] }),
  refs: many(claimRefs),
}))

export const scriptsRelations = relations(scripts, ({ one, many }) => ({
  project: one(projects, { fields: [scripts.projectId], references: [projects.id] }),
  chapters: many(chapters),
}))

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  script: one(scripts, { fields: [chapters.scriptId], references: [scripts.id] }),
  edits: many(scriptEdits),
  claimRefs: many(claimRefs),
  voiceTakes: many(voiceTakes),
  shotSlots: many(shotSlots),
}))

export const runsRelations = relations(runs, ({ one, many }) => ({
  project: one(projects, { fields: [runs.projectId], references: [projects.id] }),
  events: many(runEvents),
}))

export const runEventsRelations = relations(runEvents, ({ one }) => ({
  run: one(runs, { fields: [runEvents.runId], references: [runs.id] }),
}))

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type SettingsRow = typeof settings.$inferSelect
export type CaseRow = typeof cases.$inferSelect
export type NewCase = typeof cases.$inferInsert
export type ProjectRow = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type ClaimRow = typeof claims.$inferSelect
export type ChapterRow = typeof chapters.$inferSelect
export type VoiceTakeRow = typeof voiceTakes.$inferSelect
export type ShotSlotRow = typeof shotSlots.$inferSelect
export type AssetRow = typeof assets.$inferSelect
export type RenderRow = typeof renders.$inferSelect
export type PublishRecordRow = typeof publishRecords.$inferSelect
export type ProviderCredentialRow = typeof providerCredentials.$inferSelect
export type CostLedgerRow = typeof costLedger.$inferSelect
export type RunRow = typeof runs.$inferSelect

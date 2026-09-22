import { newId } from '@boom-busters/schemas'
import type { Settings, WordTiming } from '@boom-busters/schemas'
import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
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
  'headline',
  'graphic',
  'hero',
])

/**
 * How an article's metadata was obtained (decision 257). `manual` is sticky:
 * a record the owner corrected is never overwritten by a later fetch.
 */
export const articleStatusEnum = pgEnum('article_status', ['fetched', 'manual', 'failed'])
export const shotStatusEnum = pgEnum('shot_status', ['unresolved', 'resolved', 'placeholder'])

export const assetKindEnum = pgEnum('asset_kind', ['image', 'video', 'music', 'logo'])

export const renderKindEnum = pgEnum('render_kind', ['master', 'short', 'draft'])
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

/** Excerpts slice the master; a teaser carries its own narration (decision 225). */
export const shortKindEnum = pgEnum('short_kind', ['excerpt', 'teaser'])

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
  // Retired with the one-narrator decision (2026-08-14). Postgres cannot drop
  // an enum value without rebuilding the type, so it stays as a dead value;
  // nothing writes it, and the Connections screen no longer offers a card.
  'google-cloud-tts',
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
    /**
     * Which checkpoint of the visuals stage the project sits at
     * (staged-visuals design, 2026-08-26): `plan` between shot-list
     * generation and the fetch, `board` once assets exist. Explicit state,
     * not a heuristic over slot statuses, because a per-slot pre-fetch
     * during plan review must not flip the screen. Null outside the stage's
     * two parks' reach.
     */
    visualsPhase: text('visuals_phase', { enum: ['plan', 'board'] }),
    /**
     * The per-film Director's Book (decision 252), `DirectorsBookSchema` in
     * schemas. Null until the visuals stage drafts one; the owner's edits on
     * the plan screen are written here and survive a re-run of the stage.
     */
    direction: jsonb('direction').$type<Record<string, unknown>>(),
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
    /**
     * How many times the human has sent this dossier back for changes. The
     * reviser refuses past a limit: past three rounds the research is not the
     * problem, and another Opus pass will not fix it.
     */
    revisions: integer('revisions').notNull().default(0),
    /**
     * Bumped whenever the research is actually replaced, and the anchor
     * everything downstream is measured against.
     *
     * A script records the dossier version it was written from, so "this script
     * is stale" is that number differing from this one — derived, never stored.
     * A stored staleness flag would be a second version of the truth, and the
     * moment one write forgets to set it the console starts lying about which
     * of two documents the narration came from.
     *
     * Distinct from `revisions`, which counts how many times a human sent it
     * back. A revision changes the content and so bumps this too; a re-run from
     * scratch bumps this without being a revision.
     */
    version: integer('version').notNull().default(1),
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
    /**
     * The `dossiers.version` this script was written from.
     *
     * Null for scripts written before this column existed: their provenance is
     * genuinely unknown, and guessing "1" would assert freshness nothing
     * checked. The staleness model treats unknown as unknown and says so.
     */
    builtFromDossierVersion: integer('built_from_dossier_version'),
    status: scriptStatusEnum('status').notNull().default('draft'),
    /**
     * Shorts segments marked by the script runner (spec section 7.2).
     *
     * On the script rather than in the `shorts` table: a row there is a Short
     * being produced, with a title, a description and a render. A candidate is
     * a marking on the script made before anyone decided to build it, and
     * creating five `shorts` rows per script would fill the Shorts screen with
     * things nobody asked for.
     */
    shortsCandidates: jsonb('shorts_candidates')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<
        {
          chapterIndex: number
          startSentence: string
          endSentence: string
          hookRationale: string
        }[]
      >(),
    /**
     * The outline the chapters were drafted from, kept for what it knows and
     * the chapters do not: the tension fields (decision 216's central
     * question, per-chapter question and withhold). The Shorts marking and
     * the teaser script are written FROM those, and both can run long after
     * the script stage's memory of the outline is gone. Null for scripts
     * written before this column existed; consumers degrade to text-only.
     */
    outline: jsonb('outline').$type<Record<string, unknown>>(),
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
    /**
     * Gutter warnings from the self-check pass (spec section 7.2). Stored on
     * the chapter rather than in their own table: a warning has no identity
     * beyond the sentence it points at, and it is replaced wholesale every
     * time the chapter is re-checked.
     */
    warnings: jsonb('warnings')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<{ kind: string; sentence: string; message: string }[]>(),
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
    /**
     * Peak amplitude per bucket, 0-100, for the review row's waveform strip.
     *
     * Computed once at synthesis rather than in the browser: decoding a
     * megabyte of WAV per row to draw a 200-pixel strip would make the review
     * screen wait on sixty downloads before it could render, and the numbers
     * never change once the audio exists.
     */
    waveform: jsonb('waveform')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<number[]>(),
    /**
     * The script version this audio was read from — the provenance column that
     * makes voice staleness derivable, exactly as `scripts.
     * built_from_dossier_version` does one stage up (decision, M3.2).
     *
     * Nullable, because takes made before this column existed cannot honestly
     * claim a version. Those read as `unknown-provenance` rather than being
     * assumed current.
     */
    builtFromScriptVersion: integer('built_from_script_version'),
    /**
     * Word timings from the vendor's character alignment (M6.3), captured at
     * synthesis because they are free there and cost a Whisper run anywhere
     * else. Null means "no timings" — takes made before this column, or from
     * a vendor without alignment — and assembly falls back to transcription.
     */
    timings: jsonb('timings').$type<WordTiming[] | null>(),
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
    /** Display name; music beds carry one, fetched stock does not need one. */
    title: text('title'),
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
    /**
     * sha256 of the brief this slot's candidates were resolved FOR (the
     * no-waste guard, staged-visuals design): a fetch pass skips a resolved
     * slot whose stored hash still matches its brief, so "Fetch visuals"
     * never re-buys what nothing changed.
     */
    resolvedBriefHash: text('resolved_brief_hash'),
    /**
     * A model-assisted re-type (to chart or map) in flight or refused —
     * `SlotDraftState` in schemas. Lives on the row because the work happens
     * in an Inngest function seconds after the button, and a board that
     * cannot say "drafting" or "refused, because…" reads as a dead button.
     */
    retype: jsonb('retype').$type<Record<string, unknown>>(),
    /**
     * An image model's policy refusal for the current brief (decision 252),
     * `SlotRefusalSchema` in schemas. Cleared by any brief write; the card
     * shows it with the two ways out (redirect the scene, upload a real image).
     */
    refusal: jsonb('refusal').$type<Record<string, unknown>>(),
    /**
     * The slot whose shot this one shows instead of fetching its own
     * (decision 261). Set by the board's "Use an existing shot"; the copy
     * lands in `candidates` when the source has one, so every reader of
     * candidates stays as it is. Nulled if the source row goes.
     */
    reuseOfSlotId: text('reuse_of_slot_id').references((): AnyPgColumn => shotSlots.id, {
      onDelete: 'set null',
    }),
    /**
     * The image route the owner chose for this slot in the brief editor
     * (decision 264), as `{ provider, model }`. Nothing writes it at plan
     * time: null means derive the route by rule at generation time, which
     * is what every slot the owner has not touched does. It is part of the
     * resolution hash, so changing the model makes the slot owe work.
     */
    route: jsonb('route').$type<Record<string, unknown>>(),
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

/**
 * The cast (decision 253): the real people a film shows, with the producer's
 * reference photographs, one row per person per project. `photos` is
 * `CastPhoto[]` from schemas; the bytes live in R2 under
 * `boom-busters/cast/<projectId>/`. Its own table rather than a field on the
 * Director's Book because the book's card leaves the screen at plan approval
 * and the faces are needed for every later still.
 */
export const castMembers = pgTable(
  'cast_members',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Exact full name: the join key the shot list's `depicts` and the book's principals use. */
    name: text('name').notNull(),
    role: text('role').notNull(),
    identityString: text('identity_string').notNull().default(''),
    guardrail: text('guardrail').notNull().default(''),
    photos: jsonb('photos')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Record<string, unknown>[]>(),
    /**
     * Set when the producer removes a person the Director's Book named. The
     * row stays so the next draft of the book does not add them back; the
     * cast the app shows and generates from is the rows where this is null.
     */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('cast_members_project_name_idx').on(t.projectId, t.name)],
)

export type CastMemberRow = typeof castMembers.$inferSelect

/**
 * A film's sets (decision 264): the rooms it returns to, with the reference
 * plates that keep them the same room in every shot.
 *
 * The cast's twin, and its own table for the same reason: the Director's
 * Book's card leaves the screen when the plan is approved, and the rooms are
 * needed for every still after that. Seeded from the book's locations.
 */
export const projectSets = pgTable(
  'project_sets',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Exact name: the join key a still brief's `set` names. */
    name: text('name').notNull(),
    /** The book's look line, editable. Used to generate a plate, and nowhere else. */
    look: text('look').notNull().default(''),
    plates: jsonb('plates')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Record<string, unknown>[]>(),
    /**
     * Set when the producer removes a set the Director's Book named. The row
     * stays so the next draft of the book does not add it back; the sets the
     * app shows and generates from are the rows where this is null.
     */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('project_sets_project_name_idx').on(t.projectId, t.name)],
)
export type ProjectSetRow = typeof projectSets.$inferSelect

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
    /**
     * What this Short is (decision 225). An `excerpt` slices the project's
     * master timeline through `segmentRef`, exactly as every Short did before
     * the column existed, which is why that is the default. A `teaser` has
     * its own narration and carries its own mini master in `sourceTimeline`.
     */
    kind: shortKindEnum('kind').notNull().default('excerpt'),
    /**
     * A teaser's own mini master timeline: purpose-written narration, slots
     * lifted from the project master, captions from the synthesis timings.
     * `segmentRef` then points INTO this timeline rather than the project's,
     * and the render slices it with the same window logic excerpts use. Null
     * for excerpts.
     */
    sourceTimeline: jsonb('source_timeline').$type<Record<string, unknown>>(),
    /**
     * The teaser's editable script (decision 227): title, the 2-5 beats with
     * their chapter indexes, and the script version it was written against.
     * The teaser studio edits this and the rebuild runner re-voices from it.
     * Null for excerpts, and for teasers built before the column existed —
     * the rebuild runner regenerates and stores it on first use.
     */
    teaserScript: jsonb('teaser_script').$type<Record<string, unknown>>(),
    /**
     * The voiced beats between Voice and Assemble (decision 230):
     * TeaserVoiceRecordSchema — per beat the audio's r2Key, duration, word
     * timings and the hash of the text it spoke. Null for excerpts and for
     * teasers voiced before the studio split the two acts.
     */
    teaserVoice: jsonb('teaser_voice').$type<Record<string, unknown>>(),
    /**
     * The studio's explicit per-beat shot choices (decision 230):
     * TeaserShotsRecordSchema — full slot snapshots, null meaning auto-pick.
     * Null for excerpts and for untouched teasers.
     */
    teaserShots: jsonb('teaser_shots').$type<Record<string, unknown>>(),
    /**
     * The studio's per-beat fetched/generated new material (decision 231):
     * TeaserFetchesRecordSchema: request state plus SlotCandidate pools.
     * Null for excerpts and for teasers that never fetched anything.
     */
    teaserFetches: jsonb('teaser_fetches').$type<Record<string, unknown>>(),
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
    /**
     * Stamped by the atomic draft->uploading transition. This is what the
     * daily upload budget counts (spec section 9): uploads STARTED in the
     * current YouTube quota day — Pacific-midnight bounded, see
     * `quotaDayStartUtc` — whatever became of them afterwards.
     */
    uploadStartedAt: timestamp('upload_started_at', { withTimezone: true }),
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
    /**
     * Unique, not merely indexed: the run-mirror middleware fires on every
     * step transition and upserts by this id. Without the constraint two
     * concurrent step hooks race and the drawer shows the same run twice.
     */
    uniqueIndex('runs_inngest_run_id_key').on(t.inngestRunId),
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

/**
 * Audition samples, cached so a voice is bought once.
 *
 * Spec section 10.1 puts these in R2 ("the audition sample files in R2 for
 * later comparison"), and the adapter writes them there when storage is
 * configured. This is where they live until it is: without a cache of some
 * kind, leaving the Settings screen and coming back means paying to hear the
 * same voice read the same sentence again, which is the opposite of what an
 * audition panel is for.
 *
 * Base64 WAV in a text column rather than `bytea`, because that is the form the
 * browser plays it from and the form it arrives in — decoding it here only to
 * re-encode it on the way out would be work for nobody.
 */
export const voiceAuditions = pgTable(
  'voice_auditions',
  {
    id: id(),
    provider: providerEnum('provider').notNull(),
    voiceId: text('voice_id').notNull(),
    /** Hash of the sample text: a different sentence is a different audition. */
    sampleHash: text('sample_hash').notNull(),
    audioBase64: text('audio_base64').notNull(),
    durationMs: integer('duration_ms').notNull(),
    costUsd: usd('cost_usd').notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('voice_auditions_key').on(t.provider, t.voiceId, t.sampleHash),
    index('voice_auditions_recent_idx').on(t.createdAt),
  ],
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
// Auth
// ---------------------------------------------------------------------------
//
// There are deliberately no users/accounts/sessions tables. Auth.js runs with
// the JWT session strategy: the app has exactly one allowlisted account
// (OWNER_EMAIL), so a sessions table would store one row and buy nothing,
// while a database adapter would force proxy.ts onto the Node runtime just to
// read it. This also keeps the schema exactly to the tables spec section 5
// names.

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
  castMembers: many(castMembers),
  projectSets: many(projectSets),
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

/**
 * A cited news article's own declared metadata (decision 257).
 *
 * Keyed by normalised URL rather than by project or slot, because an article's
 * byline and publication date are fixed the moment it is published: one piece
 * can back several claims, several shots and several films, and reading it
 * twice is waste. The row is the cache AND the audit trail for what a headline
 * card put on screen.
 *
 * `provenance` records, per field, whether the value came from the page's
 * JSON-LD, its Open Graph tags, its title, the domain, an archive snapshot or
 * the owner. The board shows it, so "the outlet was guessed from the hostname"
 * is visible rather than hidden behind a confident-looking card.
 */
export const articleSources = pgTable('article_sources', {
  /** The normalised URL: no scheme case, no www., no fragment, no tracking. */
  url: text('url').primaryKey(),
  outlet: text('outlet'),
  headline: text('headline'),
  author: text('author'),
  /** Day precision, as text: the card shows a date, never a time or a zone. */
  publishedAt: text('published_at'),
  /** The standfirst, stored always and rendered only when the brief asks. */
  description: text('description'),
  provenance: jsonb('provenance')
    .notNull()
    .default(sql`'{}'::jsonb`)
    .$type<Record<string, string>>(),
  status: articleStatusEnum('status').notNull().default('failed'),
  failureReason: text('failure_reason'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

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
export type ScriptRow = typeof scripts.$inferSelect
export type ScriptEditRow = typeof scriptEdits.$inferSelect
export type ClaimRefRow = typeof claimRefs.$inferSelect
export type ScriptStatus = (typeof scriptStatusEnum.enumValues)[number]
export type EditType = (typeof editTypeEnum.enumValues)[number]
export type VoiceTakeRow = typeof voiceTakes.$inferSelect
export type VoiceAuditionRow = typeof voiceAuditions.$inferSelect
export type ShotSlotRow = typeof shotSlots.$inferSelect
export type AssetRow = typeof assets.$inferSelect
export type TimelineRow = typeof timelines.$inferSelect
export type RenderRow = typeof renders.$inferSelect
export type ShortRow = typeof shorts.$inferSelect
export type PublishRecordRow = typeof publishRecords.$inferSelect
export type ProviderCredentialRow = typeof providerCredentials.$inferSelect
export type CostLedgerRow = typeof costLedger.$inferSelect
export type RunRow = typeof runs.$inferSelect
export type RunEventRow = typeof runEvents.$inferSelect
export type AnalyticsSnapshotRow = typeof analyticsSnapshots.$inferSelect
export type ArticleSourceRow = typeof articleSources.$inferSelect
export type NewArticleSource = typeof articleSources.$inferInsert
export type ProjectStage = (typeof projectStageEnum.enumValues)[number]
export type StageStatus = (typeof stageStatusEnum.enumValues)[number]
export type RunStatus = (typeof runStatusEnum.enumValues)[number]
export type CaseCategory = (typeof caseCategoryEnum.enumValues)[number]
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number]
export type ClaimConfidence = (typeof claimConfidenceEnum.enumValues)[number]
export type ClaimSourceType = (typeof sourceTypeEnum.enumValues)[number]

export const CASE_CATEGORIES = caseCategoryEnum.enumValues
export const CLAIM_CONFIDENCES = claimConfidenceEnum.enumValues
export const CLAIM_SOURCE_TYPES = sourceTypeEnum.enumValues

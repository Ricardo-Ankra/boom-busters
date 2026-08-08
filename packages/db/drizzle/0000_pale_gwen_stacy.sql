CREATE TYPE "public"."asset_kind" AS ENUM('image', 'video', 'music', 'logo');--> statement-breakpoint
CREATE TYPE "public"."case_category" AS ENUM('collapse', 'con', 'meltdown', 'turnaround', 'empire');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('idea', 'shortlisted', 'in_production', 'published', 'retired');--> statement-breakpoint
CREATE TYPE "public"."claim_confidence" AS ENUM('sourced', 'single_source', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."edit_type" AS ENUM('human', 'regenerate');--> statement-breakpoint
CREATE TYPE "public"."privacy_status" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('dossier', 'script', 'voice', 'visuals', 'assembly', 'shorts', 'publish', 'done');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('anthropic', 'openai', 'google', 'elevenlabs', 'pexels', 'pixabay', 'fal', 'hosted-alignment', 'youtube', 'remotion');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'scheduled', 'uploading', 'uploaded', 'live', 'failed');--> statement-breakpoint
CREATE TYPE "public"."publish_target" AS ENUM('master', 'short');--> statement-breakpoint
CREATE TYPE "public"."render_kind" AS ENUM('master', 'short');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('queued', 'invoking', 'rendering', 'qc', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'failed', 'cancelled', 'awaiting_gate');--> statement-breakpoint
CREATE TYPE "public"."script_status" AS ENUM('draft', 'self_checked', 'approved');--> statement-breakpoint
CREATE TYPE "public"."short_ending" AS ENUM('loop', 'cta');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('unresolved', 'resolved', 'placeholder');--> statement-breakpoint
CREATE TYPE "public"."shot_type" AS ENUM('stock', 'archival', 'still', 'chart', 'map', 'hero');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('court', 'regulator', 'major_outlet', 'book', 'other');--> statement-breakpoint
CREATE TYPE "public"."stage_status" AS ENUM('queued', 'running', 'awaiting_review', 'approved', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."verify_status" AS ENUM('ok', 'invalid', 'unchecked');--> statement-breakpoint
CREATE TYPE "public"."voice_take_status" AS ENUM('pending', 'generated', 'flagged', 'approved');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"retention_curve" jsonb,
	"ctr_by_source" jsonb,
	"avg_view_duration_sec" integer,
	"views" integer,
	"rpm" numeric(12, 4),
	"shorts_feed_stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"r2_key" text NOT NULL,
	"source_url" text,
	"licence" text NOT NULL,
	"content_hash" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"attribution_text" text,
	"mood_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" "case_category" NOT NULL,
	"angle" text,
	"demand_notes" text,
	"competitor_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority_score" integer DEFAULT 0 NOT NULL,
	"status" "case_status" DEFAULT 'idea' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"index" integer NOT NULL,
	"title" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"est_runtime_sec" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_refs" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"sentence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"dossier_id" text NOT NULL,
	"text" text NOT NULL,
	"source_url" text,
	"source_type" "source_type" DEFAULT 'other' NOT NULL,
	"confidence" "claim_confidence" DEFAULT 'unverified' NOT NULL,
	"quarantined" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider" NOT NULL,
	"operation" text NOT NULL,
	"project_id" text,
	"estimated_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"actual_usd" numeric(12, 4),
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dossiers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"title" text NOT NULL,
	"stage" "project_stage" DEFAULT 'dossier' NOT NULL,
	"stage_status" "stage_status" DEFAULT 'queued' NOT NULL,
	"target_runtime_min" integer DEFAULT 18 NOT NULL,
	"inngest_run_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider" NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"verify_status" "verify_status" DEFAULT 'unchecked' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_provider_key" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "publish_records" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" "publish_target" NOT NULL,
	"target_id" text NOT NULL,
	"youtube_video_id" text,
	"privacy_status" "privacy_status" DEFAULT 'private' NOT NULL,
	"publish_at" timestamp with time zone,
	"uploaded_thumb_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "publish_status" DEFAULT 'draft' NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publish_records_target_key" UNIQUE("target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "renders" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"timeline_version" integer NOT NULL,
	"kind" "render_kind" NOT NULL,
	"short_id" text,
	"broker_render_id" text,
	"remotion_render_id" text,
	"status" "render_status" DEFAULT 'queued' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"output_s3_key" text,
	"qc_report" jsonb,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text,
	"kind" text NOT NULL,
	"message" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"inngest_run_id" text,
	"function_name" text NOT NULL,
	"stage" "project_stage",
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_edits" (
	"id" text PRIMARY KEY NOT NULL,
	"chapter_id" text NOT NULL,
	"before_text" text NOT NULL,
	"after_text" text NOT NULL,
	"edit_type" "edit_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "script_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shorts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"segment_ref" jsonb NOT NULL,
	"ending" "short_ending" DEFAULT 'cta' NOT NULL,
	"render_id" text,
	"related_link_checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shot_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"index" integer NOT NULL,
	"type" "shot_type" NOT NULL,
	"brief" jsonb NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_asset_id" text,
	"status" "shot_status" DEFAULT 'unresolved' NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timelines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"json" jsonb NOT NULL,
	"s3_key" text,
	"compiled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "voice_takes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"paragraph_index" integer NOT NULL,
	"provider" "provider" NOT NULL,
	"voice_id" text NOT NULL,
	"r2_key" text,
	"duration_ms" integer,
	"status" "voice_take_status" DEFAULT 'pending' NOT NULL,
	"take_number" integer DEFAULT 1 NOT NULL,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_refs" ADD CONSTRAINT "claim_refs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_refs" ADD CONSTRAINT "claim_refs_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_dossier_id_dossiers_id_fk" FOREIGN KEY ("dossier_id") REFERENCES "public"."dossiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_short_id_shorts_id_fk" FOREIGN KEY ("short_id") REFERENCES "public"."shorts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_edits" ADD CONSTRAINT "script_edits_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shorts" ADD CONSTRAINT "shorts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_slots" ADD CONSTRAINT "shot_slots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_slots" ADD CONSTRAINT "shot_slots_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_slots" ADD CONSTRAINT "shot_slots_chosen_asset_id_assets_id_fk" FOREIGN KEY ("chosen_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_takes" ADD CONSTRAINT "voice_takes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_takes" ADD CONSTRAINT "voice_takes_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_video_date_key" ON "analytics_snapshots" USING btree ("video_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_content_hash_key" ON "assets" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "assets_kind_idx" ON "assets" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cases_priority_idx" ON "cases" USING btree ("priority_score");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_script_index_key" ON "chapters" USING btree ("script_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_refs_unique" ON "claim_refs" USING btree ("chapter_id","claim_id","sentence_hash");--> statement-breakpoint
CREATE INDEX "claim_refs_claim_idx" ON "claim_refs" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "claims_dossier_idx" ON "claims" USING btree ("dossier_id","confidence");--> statement-breakpoint
CREATE INDEX "cost_ledger_provider_month_idx" ON "cost_ledger" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE INDEX "cost_ledger_project_idx" ON "cost_ledger" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dossiers_project_key" ON "dossiers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_case_idx" ON "projects" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "projects_stage_idx" ON "projects" USING btree ("stage","stage_status");--> statement-breakpoint
CREATE INDEX "renders_project_idx" ON "renders" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "renders_broker_idx" ON "renders" USING btree ("broker_render_id");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "runs_project_idx" ON "runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "runs_inngest_idx" ON "runs" USING btree ("inngest_run_id");--> statement-breakpoint
CREATE INDEX "script_edits_chapter_idx" ON "script_edits" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scripts_project_version_key" ON "scripts" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "shorts_project_idx" ON "shorts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shot_slots_chapter_index_key" ON "shot_slots" USING btree ("chapter_id","index");--> statement-breakpoint
CREATE INDEX "shot_slots_project_idx" ON "shot_slots" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "timelines_project_version_key" ON "timelines" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "voice_takes_idempotency_key" ON "voice_takes" USING btree ("idempotency_key","take_number");--> statement-breakpoint
CREATE INDEX "voice_takes_project_idx" ON "voice_takes" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "voice_takes_paragraph_idx" ON "voice_takes" USING btree ("chapter_id","paragraph_index");
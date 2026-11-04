CREATE TYPE "public"."derivation_state" AS ENUM('running', 'done', 'stopped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."exemplar_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."verdict_kind" AS ENUM('approve', 'keep-approved', 'prefer', 'revise', 'steer', 'redesign');--> statement-breakpoint
CREATE TABLE "channel_exemplars" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"technique" text NOT NULL,
	"version" integer NOT NULL,
	"status" "exemplar_status" DEFAULT 'draft' NOT NULL,
	"parent_id" text,
	"steer" text,
	"plan" jsonb NOT NULL,
	"code" jsonb NOT NULL,
	"critique" jsonb,
	"verify" jsonb,
	"pairwise" jsonb,
	"metrics" jsonb,
	"frames" jsonb,
	"derivation_id" text,
	"copied_from" text,
	"cost_usd" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "motion_derivations" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"techniques" jsonb NOT NULL,
	"rounds" integer NOT NULL,
	"cap_usd" numeric(12, 4) NOT NULL,
	"state" "derivation_state" DEFAULT 'running' NOT NULL,
	"progress" jsonb NOT NULL,
	"spent_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "motion_verdicts" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"kind" "verdict_kind" NOT NULL,
	"exemplar_id" text,
	"slot_id" text,
	"comparison" jsonb,
	"steer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_exemplars" ADD CONSTRAINT "channel_exemplars_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_derivations" ADD CONSTRAINT "motion_derivations_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_verdicts" ADD CONSTRAINT "motion_verdicts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_exemplars_version_key" ON "channel_exemplars" USING btree ("channel_id","technique","version");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_exemplars_approved_key" ON "channel_exemplars" USING btree ("channel_id","technique") WHERE status = 'approved';--> statement-breakpoint
CREATE INDEX "channel_exemplars_channel_idx" ON "channel_exemplars" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "motion_derivations_channel_idx" ON "motion_derivations" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "motion_verdicts_channel_idx" ON "motion_verdicts" USING btree ("channel_id");
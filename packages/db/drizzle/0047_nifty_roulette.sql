CREATE TYPE "public"."reference_purpose" AS ENUM('mechanism', 'look', 'pacing');--> statement-breakpoint
CREATE TYPE "public"."reference_read_state" AS ENUM('unread', 'reading', 'read', 'failed');--> statement-breakpoint
CREATE TABLE "motion_references" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"rights" text NOT NULL,
	"purpose" "reference_purpose" NOT NULL,
	"negative" boolean DEFAULT false NOT NULL,
	"window_start_ms" integer,
	"window_end_ms" integer,
	"carry_over" text NOT NULL,
	"avoid" text DEFAULT '' NOT NULL,
	"frames" jsonb NOT NULL,
	"reading" jsonb,
	"contact_sheet_key" text,
	"dense_sheet_key" text,
	"read_state" "reference_read_state" DEFAULT 'unread' NOT NULL,
	"read_error" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "motion_references" ADD CONSTRAINT "motion_references_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "motion_references" ADD CONSTRAINT "motion_references_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "motion_references_channel_position_key" ON "motion_references" USING btree ("channel_id","position") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "motion_references_channel_idx" ON "motion_references" USING btree ("channel_id");
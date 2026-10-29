ALTER TYPE "public"."provider" ADD VALUE 'vidiq';--> statement-breakpoint
CREATE TABLE "bible_drafts" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"base_bible_id" text NOT NULL,
	"bible" jsonb NOT NULL,
	"statuses" jsonb NOT NULL,
	"too_close" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"inputs" jsonb,
	"research" jsonb,
	"job" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vidiq_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"project_id" text,
	"purpose" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"credits" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bible_drafts" ADD CONSTRAINT "bible_drafts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_drafts" ADD CONSTRAINT "bible_drafts_base_bible_id_channel_bibles_id_fk" FOREIGN KEY ("base_bible_id") REFERENCES "public"."channel_bibles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vidiq_credits" ADD CONSTRAINT "vidiq_credits_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vidiq_credits" ADD CONSTRAINT "vidiq_credits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vidiq_credits_occurred_idx" ON "vidiq_credits" USING btree ("occurred_at");
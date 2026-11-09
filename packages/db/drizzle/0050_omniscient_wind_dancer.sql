CREATE TABLE "search_rank_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"video_id" text NOT NULL,
	"keyword" text NOT NULL,
	"position" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"project_id" text NOT NULL,
	"video_id" text NOT NULL,
	"checkpoint" integer NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"model_attempts" integer DEFAULT 0 NOT NULL,
	"rank_attempts" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_reports_state_check" CHECK ("search_reports"."state" in ('pending', 'frozen'))
);
--> statement-breakpoint
CREATE TABLE "search_term_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"term_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD COLUMN "search_terms" jsonb;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD COLUMN "subscribers_gained" integer;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD COLUMN "likes" integer;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD COLUMN "comments" integer;--> statement-breakpoint
ALTER TABLE "search_rank_checks" ADD CONSTRAINT "search_rank_checks_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_reports" ADD CONSTRAINT "search_reports_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_reports" ADD CONSTRAINT "search_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_term_dismissals" ADD CONSTRAINT "search_term_dismissals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_rank_checks_video_idx" ON "search_rank_checks" USING btree ("video_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_reports_video_checkpoint_key" ON "search_reports" USING btree ("video_id","checkpoint");--> statement-breakpoint
CREATE INDEX "search_reports_channel_idx" ON "search_reports" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "search_reports_project_idx" ON "search_reports" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_term_dismissals_key" ON "search_term_dismissals" USING btree ("channel_id","term_key");
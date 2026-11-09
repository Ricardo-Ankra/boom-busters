CREATE TABLE "research_suggestion_dismissals" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"key" text NOT NULL,
	"direction" text NOT NULL,
	"support_at_dismissal" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_suggestion_dismissals_direction_check" CHECK ("research_suggestion_dismissals"."direction" in ('raise', 'lower'))
);
--> statement-breakpoint
CREATE TABLE "research_tuning" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"key" text NOT NULL,
	"value" numeric NOT NULL,
	"previous" numeric,
	"evidence" text DEFAULT '' NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "research_verdict" jsonb;--> statement-breakpoint
ALTER TABLE "research_suggestion_dismissals" ADD CONSTRAINT "research_suggestion_dismissals_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tuning" ADD CONSTRAINT "research_tuning_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_suggestion_dismissals_key" ON "research_suggestion_dismissals" USING btree ("channel_id","key","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "research_tuning_channel_key" ON "research_tuning" USING btree ("channel_id","key");
CREATE TABLE "channel_search_space" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"keyword" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"outliers" jsonb NOT NULL,
	"title_patterns" jsonb NOT NULL,
	"durations" jsonb,
	"credits" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_search_space" ADD CONSTRAINT "channel_search_space_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_search_space_channel_keyword_idx" ON "channel_search_space" USING btree ("channel_id","keyword","measured_at");
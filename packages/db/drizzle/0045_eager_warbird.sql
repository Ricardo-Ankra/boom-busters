CREATE TABLE "keyword_measurements" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"keyword" text NOT NULL,
	"volume" integer,
	"competition" integer,
	"overall" integer,
	"estimated_monthly_search" integer,
	"credits" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keyword_measurements" ADD CONSTRAINT "keyword_measurements_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keyword_measurements_channel_keyword_idx" ON "keyword_measurements" USING btree ("channel_id","keyword","measured_at");
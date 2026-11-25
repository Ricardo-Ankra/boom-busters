CREATE TABLE "thumbnail_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"publish_record_id" text NOT NULL,
	"position" integer NOT NULL,
	"source" text NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"idea" text,
	"angle" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"picture" jsonb,
	"claim_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"depicts" text[] DEFAULT '{}'::text[] NOT NULL,
	"picture_key" text,
	"composed_key" text,
	"text_side" text DEFAULT 'left' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"approved_at" timestamp with time zone,
	"result" text,
	"watch_time_share" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "test_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "test_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "test_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thumbnail_packages" ADD CONSTRAINT "thumbnail_packages_publish_record_id_publish_records_id_fk" FOREIGN KEY ("publish_record_id") REFERENCES "public"."publish_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thumbnail_packages_record_idx" ON "thumbnail_packages" USING btree ("publish_record_id");
ALTER TABLE "cases" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "people" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "source_links" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "cases" ADD COLUMN "format_key" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "format_key" text DEFAULT 'main' NOT NULL;
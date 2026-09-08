CREATE TYPE "public"."short_kind" AS ENUM('excerpt', 'teaser');--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "kind" "short_kind" DEFAULT 'excerpt' NOT NULL;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "source_timeline" jsonb;
CREATE TYPE "public"."article_status" AS ENUM('fetched', 'manual', 'failed');--> statement-breakpoint
ALTER TYPE "public"."shot_type" ADD VALUE 'headline' BEFORE 'hero';--> statement-breakpoint
CREATE TABLE "article_sources" (
	"url" text PRIMARY KEY NOT NULL,
	"outlet" text,
	"headline" text,
	"author" text,
	"published_at" text,
	"description" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "article_status" DEFAULT 'failed' NOT NULL,
	"failure_reason" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

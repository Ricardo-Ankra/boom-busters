CREATE TYPE "public"."social_post_status" AS ENUM('fetched', 'manual', 'failed');--> statement-breakpoint
CREATE TABLE "social_posts" (
	"url" text PRIMARY KEY NOT NULL,
	"platform" text DEFAULT 'x' NOT NULL,
	"post_id" text NOT NULL,
	"handle" text,
	"author_name" text,
	"text" text,
	"posted_at" text,
	"ended_with_media_link" boolean DEFAULT false NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "social_post_status" DEFAULT 'failed' NOT NULL,
	"failure_reason" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cast_members" ADD COLUMN "x_handle" text;
CREATE TYPE "public"."notice_kind" AS ENUM('trimmed', 'dropped', 'stopped', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."notice_subject" AS ENUM('project', 'direction', 'dossier', 'script', 'teaser', 'cast', 'slot', 'case');--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"subject" "notice_subject" NOT NULL,
	"subject_id" text,
	"kind" "notice_kind" NOT NULL,
	"message" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_subject_idx" ON "notices" USING btree ("project_id","subject","subject_id");
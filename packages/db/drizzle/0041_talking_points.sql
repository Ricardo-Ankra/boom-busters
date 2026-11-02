ALTER TYPE "public"."notice_subject" ADD VALUE 'points';--> statement-breakpoint
ALTER TYPE "public"."notice_subject" ADD VALUE 'short';--> statement-breakpoint
ALTER TYPE "public"."short_kind" ADD VALUE 'point';--> statement-breakpoint
CREATE TABLE "talking_point_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"script_version" integer NOT NULL,
	"points" jsonb NOT NULL,
	"note" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "shorts_phase" text;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "point_id" text;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "point_script" jsonb;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "point_voice" jsonb;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "point_plan" jsonb;--> statement-breakpoint
ALTER TABLE "shorts" ADD COLUMN "point_fetches" jsonb;--> statement-breakpoint
ALTER TABLE "talking_point_sets" ADD CONSTRAINT "talking_point_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "talking_point_sets_project_version_key" ON "talking_point_sets" USING btree ("project_id","version");
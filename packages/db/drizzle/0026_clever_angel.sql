CREATE TABLE "project_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"look" text DEFAULT '' NOT NULL,
	"plates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shot_slots" ADD COLUMN "route" jsonb;--> statement-breakpoint
ALTER TABLE "project_sets" ADD CONSTRAINT "project_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_sets_project_name_idx" ON "project_sets" USING btree ("project_id","name");
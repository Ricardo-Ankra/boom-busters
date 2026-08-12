ALTER TABLE "dossiers" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN "built_from_dossier_version" integer;
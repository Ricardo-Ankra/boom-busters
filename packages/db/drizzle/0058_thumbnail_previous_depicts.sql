ALTER TABLE "thumbnail_packages" ADD COLUMN "previous_depicts" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
UPDATE "thumbnail_packages" SET "previous_depicts" = "depicts" WHERE "previous_picture_key" IS NOT NULL;

-- cases.category stops being an enum: the channel's bible lists its categories
-- (spec 2026-10-28-channel-bible-design). Boom & Busters' five keys stay valid; no row changes.
ALTER TABLE "cases" ALTER COLUMN "category" SET DATA TYPE text USING "category"::text;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_category_not_empty" CHECK ("cases"."category" <> '');--> statement-breakpoint
DROP TYPE "public"."case_category";

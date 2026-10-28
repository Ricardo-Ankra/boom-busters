-- Several channels in one console (spec 2026-10-27-multi-channel-design, section 4.9).
-- The one settings row becomes the first channel plus the workspace row, every
-- channel-owned table gains channel_id backfilled with the first channel, and the
-- youtube credential becomes that channel's connection. On a fresh database the
-- inserts select nothing and the backfills touch no rows.

-- 1. The new tables.
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"handle" text,
	"bible" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"value" jsonb NOT NULL,
	"default_channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "youtube_connections" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"key_hint" text NOT NULL,
	"youtube_channel_id" text,
	"youtube_channel_title" text,
	"verify_status" "verify_status" DEFAULT 'unchecked' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 2. The first channel from the settings row, minus the two workspace keys. The
-- bible literal must equal FIRST_CHANNEL_BIBLE (migration-0037.test.ts checks).
-- A database that lost its settings row but still holds rows the backfill points
-- at gets the channel too, on default settings, so the foreign keys below hold.
INSERT INTO "channels" ("id", "slug", "name", "handle", "bible", "settings")
SELECT '01BB0000000000000000000001', 'boom-busters', 'Boom & Busters', '@BoomAndBusters',
	'{"subject":"corporate collapses, frauds, meltdowns and turnarounds","whatACaseIs":"A good case has: a documented paper trail (court filings, regulator actions, major-outlet reporting), a clear turn where the story changes, and consequences that can be shown rather than described. A bad case is one where the only sources are other YouTube videos, or where the interesting part is speculation about what someone was thinking.","subjectKind":"the company''s common name as Wikipedia titles it","audience":"adults who watch long-form money documentaries","narrationRegister":"plain, specific, unhurried","visualRegister":"the Netflix money documentary. Dark, patient, photographic realism. The people, in the rooms where it happened: principals at the table, in the corridor, at the podium, re-created with a reconstruction''s restraint. Empty rooms, documents and objects are punctuation between them, not the film.","titleStyle":"Sober, specific, curiosity-driven","ctaLine":"The full story is on the channel","caseCategories":[{"key":"collapse","label":"Collapse"},{"key":"con","label":"Con"},{"key":"meltdown","label":"Meltdown"},{"key":"turnaround","label":"Turnaround"},{"key":"empire","label":"Empire"}],"scriptRulesMd":"","directionRulesMd":""}'::jsonb,
	coalesce((SELECT "value" FROM "settings" WHERE "id" = 'singleton'), '{}'::jsonb) - 'modelPrices' - 'budgets'
WHERE EXISTS (SELECT 1 FROM "settings" WHERE "id" = 'singleton')
	OR EXISTS (SELECT 1 FROM "cases")
	OR EXISTS (SELECT 1 FROM "publish_records")
	OR EXISTS (SELECT 1 FROM "analytics_snapshots")
	OR EXISTS (SELECT 1 FROM "cost_ledger")
	OR EXISTS (SELECT 1 FROM "runs")
	OR EXISTS (SELECT 1 FROM "assets" WHERE "kind" = 'logo');
--> statement-breakpoint
-- The workspace row: the settings row's prices and budget, defaults where absent.
INSERT INTO "workspace" ("id", "value", "default_channel_id")
SELECT 'singleton',
	jsonb_build_object(
		'modelPrices', coalesce(s."value" -> 'modelPrices', '{"llm":{},"image":{}}'::jsonb),
		'budgets', coalesce(s."value" -> 'budgets', '{"monthlyCeilingUsd":100}'::jsonb)
	),
	c."id"
FROM "channels" c
LEFT JOIN "settings" s ON s."id" = 'singleton'
WHERE c."id" = '01BB0000000000000000000001';
--> statement-breakpoint
-- 3. The youtube credential, if any, becomes the first channel's connection. Its
-- YouTube channel id is unknown until the next verify records it.
INSERT INTO "youtube_connections" ("channel_id", "encrypted_refresh_token", "key_hint", "verify_status", "last_verified_at")
SELECT '01BB0000000000000000000001', "encrypted_key", "key_hint", "verify_status", "last_verified_at"
FROM "provider_credentials"
WHERE "provider" = 'youtube' AND EXISTS (SELECT 1 FROM "channels");
--> statement-breakpoint
-- 4. Every channel_id column, added nullable, backfilled, then NOT NULL where the
-- table belongs to exactly one channel.
ALTER TABLE "cases" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "publish_records" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "channel_id" text;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "channel_id" text;
--> statement-breakpoint
UPDATE "cases" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
UPDATE "projects" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
UPDATE "publish_records" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
UPDATE "analytics_snapshots" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
UPDATE "cost_ledger" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
UPDATE "runs" SET "channel_id" = '01BB0000000000000000000001';
--> statement-breakpoint
-- Logos belong to a channel; music, stock and stills stay shared.
UPDATE "assets" SET "channel_id" = '01BB0000000000000000000001' WHERE "kind" = 'logo';
--> statement-breakpoint
ALTER TABLE "cases" ALTER COLUMN "channel_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "channel_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "publish_records" ALTER COLUMN "channel_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ALTER COLUMN "channel_id" SET NOT NULL;
--> statement-breakpoint
-- 5. Indexes and foreign keys, after the backfill. The asset hash stays unique
-- among shared rows and becomes unique per channel among a channel's own.
DROP INDEX "assets_content_hash_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_content_hash_shared_key" ON "assets" USING btree ("content_hash") WHERE channel_id is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "assets_content_hash_channel_key" ON "assets" USING btree ("content_hash","channel_id") WHERE channel_id is not null;
--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_default_channel_id_channels_id_fk" FOREIGN KEY ("default_channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "youtube_connections" ADD CONSTRAINT "youtube_connections_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cost_ledger" ADD CONSTRAINT "cost_ledger_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "analytics_snapshots_channel_idx" ON "analytics_snapshots" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "assets_channel_idx" ON "assets" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "cases_channel_idx" ON "cases" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "cost_ledger_channel_idx" ON "cost_ledger" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "projects_channel_idx" ON "projects" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "publish_records_channel_idx" ON "publish_records" USING btree ("channel_id");
--> statement-breakpoint
CREATE INDEX "runs_channel_idx" ON "runs" USING btree ("channel_id");
--> statement-breakpoint
-- 6. Cleanup: youtube is a channel connection now, and the settings row is split.
DELETE FROM "provider_credentials" WHERE "provider" = 'youtube';
--> statement-breakpoint
DROP TABLE "settings";

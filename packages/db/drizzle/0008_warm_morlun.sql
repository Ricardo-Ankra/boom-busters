CREATE TABLE "voice_auditions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider" NOT NULL,
	"voice_id" text NOT NULL,
	"sample_hash" text NOT NULL,
	"audio_base64" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"cost_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "voice_auditions_key" ON "voice_auditions" USING btree ("provider","voice_id","sample_hash");--> statement-breakpoint
CREATE INDEX "voice_auditions_recent_idx" ON "voice_auditions" USING btree ("created_at");